import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SbtEhrDnsFoundationStack } from '../lib/dns-foundation-stack';
import { SbtEhrControlPlaneStack } from '../lib/control-plane-stack';
import { SbtEhrAppPlaneStack } from '../lib/app-plane-stack';
import { SbtEhrAdminPortalStack } from '../lib/admin-portal-stack';

const env = { account: '772961519025', region: 'us-east-1' };
const ADMIN_EMAIL = 'admin@test.com';

test('DnsFoundationStack creates Route 53 zone, certificate and SSM params', () => {
  const app = new App();
  const stack = new SbtEhrDnsFoundationStack(app, 'Dns', {
    env,
    parentHostedZoneId: 'Z09926322TOGOZX0SJXS8',
    parentDomain: 'aws.gerardocastillo.me',
    subDomain: 'pruebas',
    rootDomain: 'pruebas.aws.gerardocastillo.me',
  });
  const t = Template.fromStack(stack);
  t.resourceCountIs('AWS::Route53::HostedZone', 1);
  t.resourceCountIs('AWS::CertificateManager::Certificate', 1);
  t.resourceCountIs('AWS::SSM::Parameter', 3);
});

test('ControlPlaneStack creates CognitoAuth + ControlPlane + FeatureService', () => {
  const app = new App();
  const stack = new SbtEhrControlPlaneStack(app, 'ControlPlane', { env, adminEmail: ADMIN_EMAIL });
  const t = Template.fromStack(stack);
  t.resourceCountIs('AWS::Cognito::UserPool', 1);
  t.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
  t.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
  t.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
  t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
    AuthorizerType: 'JWT',
  });
  t.hasResourceProperties('AWS::SSM::Parameter', {
    Name: '/sbt-demo-ehr/event-bus-name',
  });
});

test('AppPlaneStack creates bucket + ProvisioningScriptJob + DeprovisioningScriptJob', () => {
  const app = new App();
  const cp = new SbtEhrControlPlaneStack(app, 'ControlPlane', { env, adminEmail: ADMIN_EMAIL });
  const stack = new SbtEhrAppPlaneStack(app, 'AppPlane', {
    env,
    eventManager: cp.controlPlane.eventManager,
    tenantInfraVersion: '1.0.0',
  });
  const t = Template.fromStack(stack);
  t.resourceCountIs('AWS::S3::Bucket', 1);
  t.resourceCountIs('AWS::SSM::Parameter', 1);
  t.resourceCountIs('AWS::CodeBuild::Project', 2);
  t.resourceCountIs('AWS::StepFunctions::StateMachine', 2);
});

test('AdminPortalStack creates CloudFront distribution + Route53 alias', () => {
  const app = new App();
  const dns = new SbtEhrDnsFoundationStack(app, 'Dns', {
    env,
    parentHostedZoneId: 'Z09926322TOGOZX0SJXS8',
    parentDomain: 'aws.gerardocastillo.me',
    subDomain: 'pruebas',
    rootDomain: 'pruebas.aws.gerardocastillo.me',
  });
  const cp = new SbtEhrControlPlaneStack(app, 'ControlPlane', { env, adminEmail: ADMIN_EMAIL });
  const stack = new SbtEhrAdminPortalStack(app, 'Portal', {
    env,
    adminFqdn: 'admin.pruebas.aws.gerardocastillo.me',
    zone: dns.hostedZone,
    certificate: dns.certificate,
    userPoolId: cp.cognitoAuth.userPool.userPoolId,
    userPoolClientId: cp.cognitoAuth.userClientId,
    cognitoDomain: 'sbt-ehr-admin-test.auth.us-east-1.amazoncognito.com',
    controlPlaneApiUrl: cp.controlPlane.controlPlaneAPIGatewayUrl,
    featureApiUrl: cp.featureService.api.apiEndpoint,
  });
  const t = Template.fromStack(stack);
  t.resourceCountIs('AWS::CloudFront::Distribution', 1);
  t.resourceCountIs('AWS::Route53::RecordSet', 1);
});