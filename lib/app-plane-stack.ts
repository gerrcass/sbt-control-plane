import * as cdk from 'aws-cdk-lib';
import * as sbt from '@cdklabs/sbt-aws';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import { join } from 'path';

const SSM_PREFIX = '/sbt-demo-ehr';

export interface SbtEhrAppPlaneStackProps extends cdk.StackProps {
  readonly eventManager: sbt.IEventManager;
  readonly tenantInfraVersion: string;
}

export class SbtEhrAppPlaneStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SbtEhrAppPlaneStackProps) {
    super(scope, id, props);

    const artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: `sbt-demo-ehr-artifacts-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new ssm.StringParameter(this, 'ArtifactsBucketName', {
      parameterName: `${SSM_PREFIX}/artifacts-bucket-name`,
      stringValue: artifactsBucket.bucketName,
    });

    // DEMO ONLY: broad IAM for provisioning CodeBuild
    const demoPermissions = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['*'],
          resources: ['*'],
          sid: 'DemoProvisioning',
        }),
      ],
    });

    const provisionScript = readFileSync(join(__dirname, '../scripts/provision-tenant.sh'), 'utf8');
    const deprovisionScript = readFileSync(join(__dirname, '../scripts/deprovision-tenant.sh'), 'utf8');

    const provisionJob = new sbt.ProvisioningScriptJob(this, 'ProvisionTenant', {
      permissions: demoPermissions,
      script: provisionScript,
      environmentStringVariablesFromIncomingEvent: [
        'tenantId',
        'tenantName',
        'email',
        'tier',
      ],
      environmentVariablesToOutgoingEvent: {
        tenantData: ['tenantConfig', 'tenantStatus'],
      },
      scriptEnvironmentVariables: {
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
        APP_VERSION: props.tenantInfraVersion,
      },
      buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      projectProps: {
        timeout: cdk.Duration.minutes(90),
      },
      eventManager: props.eventManager,
    });

    const deprovisionJob = new sbt.DeprovisioningScriptJob(this, 'DeprovisionTenant', {
      permissions: demoPermissions,
      script: deprovisionScript,
      environmentStringVariablesFromIncomingEvent: [
        'tenantId',
        'tenantName',
        'email',
        'tier',
      ],
      environmentVariablesToOutgoingEvent: {
        tenantRegistrationData: ['registrationStatus'],
      },
      scriptEnvironmentVariables: {
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
        APP_VERSION: props.tenantInfraVersion,
      },
      buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      eventManager: props.eventManager,
    });

    new sbt.CoreApplicationPlane(this, 'CoreApplicationPlane', {
      eventManager: props.eventManager,
      scriptJobs: [provisionJob, deprovisionJob],
    });
  }
}