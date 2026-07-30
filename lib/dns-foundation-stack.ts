import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

const SSM_PREFIX = '/sbt-demo-ehr';

export interface SbtEhrDnsFoundationStackProps extends cdk.StackProps {
  readonly parentHostedZoneId: string;
  readonly parentDomain: string;
  readonly subDomain: string;
  readonly rootDomain: string;
}

export class SbtEhrDnsFoundationStack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: SbtEhrDnsFoundationStackProps) {
    super(scope, id, props);

    // Delegated subzone pruebas.aws.gerardocastillo.me
    this.hostedZone = new route53.PublicHostedZone(this, 'SubZone', {
      zoneName: props.rootDomain,
    });

    // NS delegation record in the parent zone aws.gerardocastillo.me
    const parentZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ParentZone', {
      hostedZoneId: props.parentHostedZoneId,
      zoneName: props.parentDomain,
    });

    new route53.NsRecord(this, 'Delegation', {
      zone: parentZone,
      recordName: props.subDomain,
      values: this.hostedZone.hostedZoneNameServers!,
    });

    // Wildcard ACM certificate for *.pruebas.aws.gerardocastillo.me
    this.certificate = new acm.Certificate(this, 'WildcardCert', {
      domainName: `*.${props.rootDomain}`,
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });

    // SSM parameters for cross-repo runtime access
    const params: Record<string, string> = {
      'hosted-zone-id': this.hostedZone.hostedZoneId,
      'root-domain': props.rootDomain,
      'wildcard-certificate-arn': this.certificate.certificateArn,
    };

    Object.entries(params).forEach(([key, value]) => {
      new ssm.StringParameter(this, `Param_${key}`, {
        parameterName: `${SSM_PREFIX}/${key}`,
        stringValue: value,
      });
    });
  }
}