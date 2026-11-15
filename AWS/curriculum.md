# Lộ Trình Học AWS Certified Developer – Associate (DVA-C02 / DVA-C03)

> **Phương pháp học:** Mỗi tập video dài **3–5 phút (16:9 Full HD)** được AI Agent thiết kế theo chuẩn 4 phần:
> 1. **Bài toán thực tế** (Tại sao cần dịch vụ này?)
> 2. **Sơ đồ Kiến trúc Động** (Luồng gói tin và cơ chế hoạt động bên trong)
> 3. **Hướng dẫn Setup trực quan** (Clean Console Mockup + CLI / JSON / SDK Code)
> 4. **Bẫy đề thi DVA-C02 & Câu hỏi trắc nghiệm**

---

## Tổng quan Phân bổ Trọng số Kỳ thi DVA-C02
- **Domain 1:** Development with AWS Services (**32%**)
- **Domain 2:** Security (**26%**)
- **Domain 3:** Deployment (**24%**)
- **Domain 4:** Troubleshooting and Optimization (**18%**)

---

## Chặng 1: Nền tảng Cloud & Bảo mật IAM (Foundations & Security)

| Tập | Slug | Chủ đề | Hiểu bản chất & Setup | Bẫy đề thi DVA-C02 |
| :-: | :--- | :--- | :--- | :--- |
| **01** | `ep01-iam-core` | **IAM Cốt Lõi (Users, Groups, Roles & Policies)** | Phân biệt User/Group/Role/Policy; Tạo EC2 Role trên Console & kiểm tra bằng AWS CLI/boto3 | Luôn dùng IAM Role cho EC2/Lambda; `Explicit Deny` thắng mọi `Allow` |
| **02** | `ep02-sts-assumerole` | **AWS STS, AssumeRole & Cross-Account Access** | Luồng `sts:AssumeRole`, ExternalId, Session Duration & cấp quyền sang tài khoản AWS khác | Phân biệt Trust Policy vs Permissions Policy |
| **03** | `ep03-cli-sdk-credentials` | **AWS CLI, SDK & Credential Provider Chain** | Cấu hình `aws configure`, Named Profiles, thứ tự ưu tiên tìm credentials của SDK | Biến môi trường ghi đè `~/.aws/credentials`, Role ghi đè Instance |
| **04** | `ep04-kms-ssm-secrets` | **Mã hóa KMS, SSM Parameter Store & Secrets Manager** | Envelope Encryption (`GenerateDataKey`), quản lý biến môi trường và xoay vòng mật khẩu DB | Giới hạn `4KB` của KMS Encrypt trực tiếp; Secrets Manager tự động Rotate |

---

## Chặng 2: Máy chủ ảo & Lưu trữ cốt lõi (Core Compute & Storage)

| Tập | Slug | Chủ đề | Hiểu bản chất & Setup | Bẫy đề thi DVA-C02 |
| :-: | :--- | :--- | :--- | :--- |
| **05** | `ep05-ec2-dev-essentials` | **EC2 cho Developer: User Data, IMDSv2 & Security Groups** | Script khởi tạo User Data, truy vấn Instance Metadata (`169.254.169.254`) an toàn với IMDSv2 | Security Group là Stateful; NACL là Stateless |
| **06** | `ep06-alb-autoscaling` | **ALB, Target Groups & Auto Scaling** | Đường đi Request qua Application Load Balancer, Health Checks & Sticky Sessions | Sticky Sessions trên ALB dùng cookie do ALB/App sinh; X-Forwarded-For |
| **07** | `ep07-s3-fundamentals` | **Amazon S3 toàn tập: Buckets, Storage Classes & Versioning** | Cấu trúc Object/Key, Multipart Upload (`>100MB` nên dùng, `>5GB` bắt buộc), Lifecycle Rules | S3 Strong Read-After-Write Consistency cho mọi thao tác |
| **08** | `ep08-s3-security-presigned` | **S3 Security: Bucket Policy, CORS, Encryption & Pre-signed URLs** | Cấp link upload/download tạm thời cho User không có tài khoản AWS, bật SSE-S3 / SSE-KMS | Khi gặp lỗi `AccessDenied` từ trình duyệt gọi S3 từ domain khác -> CORS |
| **09** | `ep09-cloudfront-cdn` | **Amazon CloudFront: OAC, Caching & Signed URLs** | Tăng tốc toàn cầu qua Edge Locations, chặn truy cập trực tiếp S3 bằng OAC | CloudFront Signed URL vs S3 Pre-signed URL (khi nào dùng cái nào?) |

---

## Chặng 3: Trái tim của DVA-C02 – Serverless (Lambda, API Gateway, DynamoDB)

| Tập | Slug | Chủ đề | Hiểu bản chất & Setup | Bẫy đề thi DVA-C02 |
| :-: | :--- | :--- | :--- | :--- |
| **10** | `ep10-lambda-internals` | **AWS Lambda hoạt động thế nào? Event, Context & Execution Role** | Sync vs Async vs Event Source Mapping; khai báo biến ngoài Handler để tái sử dụng kết nối DB | Lambda Timeout tối đa 15 phút; `/tmp` tối đa 10GB |
| **11** | `ep11-lambda-concurrency-layers` | **Lambda Cold Start, Concurrency & Layers** | Reserved Concurrency vs Provisioned Concurrency, đóng gói thư viện dùng chung vào Layer | Lỗi `429 TooManyRequests` khi vượt giới hạn Concurrency vùng |
| **12** | `ep12-lambda-versions-aliases` | **Lambda Versions, Aliases & Canary Deployment** | Đóng băng `$LATEST` thành Version, trỏ Alias `prod` chia traffic 90/10 | Alias trỏ tới Version (bất biến), không thể sửa code trong Version đã publish |
| **13** | `ep13-apigateway-rest-http` | **API Gateway: REST vs HTTP API, Mapping & Stages** | Tích hợp Lambda Proxy Integration, Stage Variables & Canary Release | HTTP API rẻ hơn ~70% và nhanh hơn REST API |
| **14** | `ep14-apigateway-auth-throttling` | **API Gateway Authorizers, Caching & Throttling** | Lambda Authorizer trả về IAM Policy, Cognito Authorizer, Usage Plans & API Keys | Bật API Caching trả về `429` vs Cache Invalidation header |
| **15** | `ep15-dynamodb-keys-capacity` | **DynamoDB: Partition Key, Sort Key, RCU/WCU & Query vs Scan** | Thiết kế Primary Key chống Hot Partition; tính toán RCU/WCU (Eventually vs Strongly Consistent) | Luôn ưu tiên `Query` thay vì `Scan`; `ProvisionedThroughputExceededException` |
| **16** | `ep16-dynamodb-indexes-streams` | **DynamoDB GSI/LSI, TTL, Streams & DAX** | Tạo LSI (tạo lúc khởi tạo bảng) vs GSI (tạo bất kỳ lúc nào); kích hoạt Lambda từ Streams | DAX cache kết quả Read (microsecond), không dùng cho write-heavy |

---

## Chặng 4: Kiến trúc Hướng sự kiện & Vi dịch vụ (Event-Driven & Decoupling)

| Tập | Slug | Chủ đề | Hiểu bản chất & Setup | Bẫy đề thi DVA-C02 |
| :-: | :--- | :--- | :--- | :--- |
| **17** | `ep17-sqs-standard-fifo` | **Amazon SQS: Visibility Timeout, Long Polling, FIFO & DLQ** | Tách rời Producer/Consumer, tránh xử lý trùng bằng Visibility Timeout & Dead-Letter Queue | Long Polling (`WaitTimeSeconds = 20`) giảm chi phí & empty responses |
| **18** | `ep18-sns-fanout` | **Amazon SNS & Mô hình Fan-Out (SNS + SQS)** | 1 thông báo gửi đồng thời tới nhiều Queue/Lambda độc lập qua Filter Policy | Fan-out đảm bảo không mất message khi thêm Consumer mới |
| **19** | `ep19-eventbridge` | **Amazon EventBridge: Event Buses, Rules & Schema** | Kết nối dịch vụ AWS, SaaS và Custom App bằng JSON Pattern Matching | EventBridge thay thế CloudWatch Events với lọc nội dung JSON mạnh hơn SNS |
| **20** | `ep20-step-functions` | **AWS Step Functions: State Machines & Error Handling** | Điều phối nhiều Lambda tuần tự/song song, Retry/Catch, Wait states & Callback tokens | Standard (lâu tới 1 năm, Exactly-Once) vs Express (tốc độ cao, < 5 phút) |
| **21** | `ep21-kinesis-streams` | **Kinesis Data Streams vs Firehose** | Phân mảnh Shard, Partition Key, `ProvisionedThroughputExceededException` | Kinesis giữ thứ tự theo Partition Key; Firehose tự đẩy thẳng ra S3/Redshift |

---

## Chặng 5: Containers & Tự động hóa CI/CD, IaC (Deployment & Containers)

| Tập | Slug | Chủ đề | Hiểu bản chất & Setup | Bẫy đề thi DVA-C02 |
| :-: | :--- | :--- | :--- | :--- |
| **22** | `ep22-docker-ecr-ecs` | **Docker trên AWS: ECR, ECS Task Definitions & Fargate** | Đẩy Image lên ECR, chạy Container không cần quản lý EC2 bằng Fargate | Phân biệt **Task Role** (code bên trong container dùng) vs **Execution Role** (ECS Agent kéo image/ghi log) |
| **23** | `ep23-elastic-beanstalk` | **Elastic Beanstalk: Deployment Policies & `.ebextensions`** | All at Once, Rolling, Rolling with Additional Batch, Immutable, Blue/Green | Immutable vs Rolling (tạo ASG mới an toàn, rollback tức thì) |
| **24** | `ep24-cloudformation-core` | **AWS CloudFormation: Templates, Intrinsic Functions & Rollbacks** | `!Ref`, `!GetAtt`, `!Sub`, Cross-Stack Outputs (`Export`/`Fn::ImportValue`) | `DeletionPolicy: Retain` bảo vệ Database khỏi bị xóa nhầm |
| **25** | `ep25-aws-sam-cdk` | **AWS SAM & AWS CDK cho Serverless** | `template.yaml` với `Transform: AWS::Serverless-2016-10-31`, `sam local invoke`, `sam deploy` | Lệnh `sam package` & `sam deploy`; Policy Templates có sẵn của SAM |
| **26** | `ep26-cicd-codepipeline` | **Bộ tứ CI/CD: CodeBuild, CodeDeploy & CodePipeline** | Cấu trúc `buildspec.yml` (phases, artifacts, cache) & `appspec.yml` (hooks ordering) | Thứ tự Hooks trong CodeDeploy (In-place vs Blue/Green) |

---

## Chặng 6: Xác thực, Quan sát hệ thống & Tổng ôn DVA-C02

| Tập | Slug | Chủ đề | Hiểu bản chất & Setup | Bẫy đề thi DVA-C02 |
| :-: | :--- | :--- | :--- | :--- |
| **27** | `ep27-cognito-pools` | **Amazon Cognito: User Pools vs Identity Pools** | Đăng nhập JWT (User Pool) $\rightarrow$ Đổi lấy Temporary AWS Credentials truy cập S3 (Identity Pool) | User Pool = Authentication; Identity Pool = Authorization vào tài nguyên AWS |
| **28** | `ep28-elasticache-redis` | **Amazon ElastiCache (Redis/Memcached)** | Chiến lược Cache: Lazy Loading vs Write-Through & TTL | Redis hỗ trợ Persistence, Multi-AZ, Sorted Sets (Leaderboard); Memcached đa luồng |
| **29** | `ep29-cloudwatch-xray` | **CloudWatch Logs/Alarms & AWS X-Ray Tracing** | Embedded Metric Format (EMF), X-Ray SDK, Annotations vs Metadata | Annotations được lập chỉ mục để Filter; Metadata chỉ để lưu thêm thông tin |
| **30** | `ep30-dva-exam-mastery` | **Tổng ôn DVA-C02: Giải phẫu 10 dạng bẫy đề thi kinh điển** | Checklist toàn khóa học + Chiến thuật loại trừ đáp án nhiễu trong 130 phút thi thật | Tổng hợp toàn bộ các cặp dịch vụ hay gây nhầm lẫn nhất |
