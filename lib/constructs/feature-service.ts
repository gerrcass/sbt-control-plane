import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Construct } from 'constructs';
import path = require('path');

export interface TenantFeatureServiceProps {
  readonly userPool: cognito.IUserPool;
  readonly userPoolClientId: string;
  readonly eventBusName: string;
}

export class TenantFeatureService extends Construct {
  public readonly api: apigatewayv2.HttpApi;
  public readonly handler: lambda.IFunction;

  constructor(scope: Construct, id: string, props: TenantFeatureServiceProps) {
    super(scope, id);

    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.handler = new lambdaNodejs.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../src/feature-service/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      bundling: { minify: true },
      environment: {
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: props.eventBusName,
        EVENT_SOURCE: 'controlPlaneEventSource',
        EVENT_DETAIL_TYPE: 'TenantFeatureUpdated',
      },
    });

    table.grantReadWriteData(this.handler);

    const issuer = `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${props.userPool.userPoolId}`;

    const authorizer = new apigwAuthorizers.HttpJwtAuthorizer('JwtAuthorizer', issuer, {
      jwtAudience: [props.userPoolClientId],
    });

    this.api = new apigatewayv2.HttpApi(this, 'Api', {
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: ['https://admin.pruebas.aws.gerardocastillo.me', 'http://localhost:5173'],
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.PUT, apigatewayv2.CorsHttpMethod.OPTIONS],
      },
    });

    this.api.addRoutes({
      path: '/feature-catalog',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigwIntegrations.HttpLambdaIntegration('CatalogIntegration', this.handler),
      authorizer,
    });

    this.api.addRoutes({
      path: '/tenant-features/{tenantId}',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT],
      integration: new apigwIntegrations.HttpLambdaIntegration('FeatureIntegration', this.handler),
      authorizer,
    });
  }
}