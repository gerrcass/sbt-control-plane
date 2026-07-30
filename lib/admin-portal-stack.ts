import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { existsSync } from 'fs';
import { join } from 'path';

export interface SbtEhrAdminPortalStackProps extends cdk.StackProps {
  readonly adminFqdn: string;
  readonly zone: route53.IHostedZone;
  readonly certificate: acm.ICertificate;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly cognitoDomain: string;
  readonly controlPlaneApiUrl: string;
  readonly featureApiUrl: string;
}

export class SbtEhrAdminPortalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SbtEhrAdminPortalStackProps) {
    super(scope, id, props);

    const portalBucket = new s3.Bucket(this, 'PortalBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const originAccessControl = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
      originAccessControlName: 'portal-oac',
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      domainNames: [props.adminFqdn],
      certificate: props.certificate,
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(portalBucket, {
          originAccessControl,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    const portalDistPath = join(__dirname, '../portal/dist');
    const hasDist = existsSync(join(portalDistPath, 'index.html'));

    if (hasDist) {
      new s3deploy.BucketDeployment(this, 'PortalDeploy', {
        sources: [s3deploy.Source.asset(portalDistPath)],
        destinationBucket: portalBucket,
        distribution,
        distributionPaths: ['/*'],
      });
    } else {
      new s3deploy.BucketDeployment(this, 'PortalPlaceholder', {
        sources: [
          s3deploy.Source.data('index.html', '<html><body>Portal de administraci&oacute;n — ejecuta <code>npm run build</code> en portal/</body></html>'),
        ],
        destinationBucket: portalBucket,
      });
    }

    new route53.ARecord(this, 'AdminAlias', {
      zone: props.zone,
      recordName: 'admin',
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    new cdk.CfnOutput(this, 'PortalUrl', { value: `https://${props.adminFqdn}` });
    new cdk.CfnOutput(this, 'PortalBucketName', { value: portalBucket.bucketName });
  }
}