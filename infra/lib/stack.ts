import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import * as path from 'node:path';

export interface SprayWallProps extends StackProps {
  ownerEmail: string;
  initialInvite: string;
  appOrigins: string[];
}

/**
 * Everything the shared spray wall needs: accounts (Cognito), an API (API
 * Gateway + one Lambda), data (DynamoDB) and photos (S3 behind CloudFront).
 * Data and photos are kept if the stack is ever deleted.
 */
export class SprayWallStack extends Stack {
  constructor(scope: Construct, id: string, props: SprayWallProps) {
    super(scope, id, props);

    const table = new dynamodb.TableV2(this, 'Data', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const photos = new s3.Bucket(this, 'Photos', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [{ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: props.appOrigins, allowedHeaders: ['*'], maxAge: 3600 }],
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(90) }],
    });

    const cdn = new cloudfront.Distribution(this, 'PhotoCdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(photos),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // The app draws photos onto canvases (thumbnails, detection), which needs CORS.
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    const photoCdnUrl = `https://${cdn.distributionDomainName}`;

    const lambdaDefaults = {
      runtime: Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(15),
      logRetention: RetentionDays.ONE_MONTH,
      bundling: { minify: true, sourceMap: true },
    };

    const preSignUp = new NodejsFunction(this, 'PreSignUp', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '../lambda/preSignUp.ts'),
      environment: { TABLE_NAME: table.tableName, INITIAL_INVITE: props.initialInvite },
    });
    table.grantReadData(preSignUp);

    const users = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { fullname: { required: true, mutable: true } },
      passwordPolicy: { minLength: 8, requireLowercase: false, requireUppercase: false, requireDigits: false, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      lambdaTriggers: { preSignUp },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const client = users.addClient('Web', {
      authFlows: { userPassword: true },
      preventUserExistenceErrors: true,
      // Stay signed in for a year on each device.
      refreshTokenValidity: Duration.days(365),
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
    });

    const api = new NodejsFunction(this, 'Api', {
      ...lambdaDefaults,
      entry: path.join(__dirname, '../lambda/api.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        OWNER_EMAIL: props.ownerEmail,
        INITIAL_INVITE: props.initialInvite,
        PHOTO_BUCKET: photos.bucketName,
        PHOTO_CDN_URL: photoCdnUrl,
        USER_POOL_ID: users.userPoolId,
      },
    });
    table.grantReadWriteData(api);
    photos.grantPut(api);
    users.grant(api, 'cognito-idp:ListUsers', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminUserGlobalSignOut');

    const httpApi = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: props.appOrigins,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.PUT, CorsHttpMethod.POST, CorsHttpMethod.DELETE],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.days(1),
      },
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', api);
    // API Gateway verifies sign-in tokens before the Lambda runs.
    const authorizer = new HttpJwtAuthorizer('Jwt', `https://cognito-idp.${this.region}.amazonaws.com/${users.userPoolId}`, {
      jwtAudience: [client.userPoolClientId],
    });
    httpApi.addRoutes({ path: '/state', methods: [HttpMethod.GET], integration });
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.POST, HttpMethod.DELETE],
      integration,
      authorizer,
    });

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: users.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'PhotoCdnUrl', { value: photoCdnUrl });
    new CfnOutput(this, 'Region', { value: this.region });
  }
}
