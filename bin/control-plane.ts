#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SbtEhrDnsFoundationStack } from '../lib/dns-foundation-stack';
import { SbtEhrControlPlaneStack } from '../lib/control-plane-stack';
import { SbtEhrAppPlaneStack } from '../lib/app-plane-stack';
import { SbtEhrAdminPortalStack } from '../lib/admin-portal-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const adminEmail = app.node.tryGetContext('adminEmail');
if (!adminEmail) {
  console.error('ERROR: cdk context "adminEmail" is required.');
  process.exit(1);
}
const tenantInfraVersion = app.node.tryGetContext('tenantInfraVersion') ?? '1.0.0';

const dns = new SbtEhrDnsFoundationStack(app, 'SbtEhrDnsFoundationStack', {
  env,
  parentHostedZoneId: 'Z09926322TOGOZX0SJXS8',
  parentDomain: 'aws.gerardocastillo.me',
  subDomain: 'pruebas',
  rootDomain: 'pruebas.aws.gerardocastillo.me',
});

const controlPlane = new SbtEhrControlPlaneStack(app, 'SbtEhrControlPlaneStack', {
  env,
  adminEmail,
});

const appPlane = new SbtEhrAppPlaneStack(app, 'SbtEhrAppPlaneStack', {
  env,
  eventManager: controlPlane.controlPlane.eventManager,
  tenantInfraVersion,
});

const adminPortal = new SbtEhrAdminPortalStack(app, 'SbtEhrAdminPortalStack', {
  env,
  adminFqdn: 'admin.pruebas.aws.gerardocastillo.me',
  zone: dns.hostedZone,
  certificate: dns.certificate,
  userPoolId: controlPlane.cognitoAuth.userPool.userPoolId,
  userPoolClientId: controlPlane.cognitoAuth.userClientId,
  cognitoDomain: controlPlane.cognitoAdminDomain,
  controlPlaneApiUrl: controlPlane.controlPlane.controlPlaneAPIGatewayUrl,
  featureApiUrl: controlPlane.featureService.api.apiEndpoint,
});