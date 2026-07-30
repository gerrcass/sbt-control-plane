import * as cdk from 'aws-cdk-lib';
import * as sbt from '@cdklabs/sbt-aws';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { TenantFeatureService } from './constructs/feature-service';

const SSM_PREFIX = '/sbt-demo-ehr';

export interface SbtEhrControlPlaneStackProps extends cdk.StackProps {
  readonly adminEmail: string;
}

export class SbtEhrControlPlaneStack extends cdk.Stack {
  public readonly cognitoAuth: sbt.CognitoAuth;
  public readonly controlPlane: sbt.ControlPlane;
  public readonly featureService: TenantFeatureService;

  constructor(scope: Construct, id: string, props: SbtEhrControlPlaneStackProps) {
    super(scope, id, props);

    this.cognitoAuth = new sbt.CognitoAuth(this, 'CognitoAuth', {
      enableAdvancedSecurityMode: false,
      setAPIGWScopes: false,
      controlPlaneCallbackURL: 'https://admin.pruebas.aws.gerardocastillo.me/',
    });

    // Hosted UI domain for the admin user pool
    new cognito.UserPoolDomain(this, 'AdminDomain', {
      userPool: this.cognitoAuth.userPool,
      cognitoDomain: { domainPrefix: `sbt-ehr-admin-${this.account}` },
    });

    this.controlPlane = new sbt.ControlPlane(this, 'ControlPlane', {
      auth: this.cognitoAuth,
      systemAdminEmail: props.adminEmail,
    });

    // Event bus name to SSM
    new ssm.StringParameter(this, 'EventBusName', {
      parameterName: `${SSM_PREFIX}/event-bus-name`,
      stringValue: this.controlPlane.eventManager.busName,
    });

    // Tenant feature service (custom extension)
    this.featureService = new TenantFeatureService(this, 'FeatureService', {
      userPool: this.cognitoAuth.userPool,
      userPoolClientId: this.cognitoAuth.userClientId,
      eventBusName: this.controlPlane.eventManager.busName,
    });
    this.controlPlane.eventManager.grantPutEventsTo(this.featureService.handler);

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.cognitoAuth.userPool.userPoolId,
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.cognitoAuth.userClientId,
    });
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `sbt-ehr-admin-${this.account}.auth.${this.region}.amazoncognito.com`,
    });
    new cdk.CfnOutput(this, 'ControlPlaneApiUrl', {
      value: this.controlPlane.controlPlaneAPIGatewayUrl,
    });
    new cdk.CfnOutput(this, 'FeatureApiUrl', {
      value: this.featureService.api.apiEndpoint,
    });
  }
}