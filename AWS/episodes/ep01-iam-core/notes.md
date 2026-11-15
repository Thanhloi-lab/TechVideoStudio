# Tập 01: IAM Cốt Lõi (Users, Groups, Roles & Policies)

> **Mục tiêu:** Nắm vững 4 thành phần cốt lõi của AWS IAM, cơ chế hoạt động của `IAM Role` + `AWS STS`, cách cấu hình thực tế trên Console / AWS CLI / Boto3 và nhận diện bẫy đề thi **AWS Certified Developer – Associate (DVA-C02)**.

---

## 1. One-Page Cheat Sheet

| Khái niệm | Bản chất & Cách dùng | Lưu ý quan trọng (Exam & Production) |
| :--- | :--- | :--- |
| **Root Account** | Tài khoản gốc tạo khi đăng ký AWS | Bật MFA ngay, khóa Access Key, **không dùng cho công việc hằng ngày** |
| **IAM User** | Danh tính lâu dài cho con người (username/password + Access Key) | Mỗi người 1 User riêng; áp dụng MFA |
| **IAM Group** | Nhóm chứa nhiều IAM User cùng vai trò (VD: `Developers`, `Admins`) | Group **không thể lồng Group khác**; User có thể thuộc nhiều Group |
| **IAM Policy** | Văn bản JSON định nghĩa quyền (`Effect`, `Action`, `Resource`) | **Explicit Deny luôn thắng mọi Allow**; mặc định là **Implicit Deny** |
| **IAM Role** | Danh tính tạm thời cho dịch vụ AWS (`EC2`, `Lambda`, `ECS`) hoặc Cross-account | Không có mật khẩu/key tĩnh; dùng **AWS STS** phát hành `SessionToken` tự hết hạn |
| **Instance Profile** | Vỏ bọc chứa đúng 1 IAM Role để gắn vào EC2 instance | Khi tạo Role cho EC2 trên Console, AWS tự tạo Instance Profile cùng tên |

### Quy tắc xét duyệt quyền (Policy Evaluation Logic)
1. Mặc định: **Implicit Deny** (Chưa có lệnh cho phép = Từ chối).
2. Kiểm tra tất cả Policy áp dụng: Có bất kỳ **Explicit Deny** nào không? $\rightarrow$ Nếu **CÓ**, chặn ngay lập tức (`AccessDenied`).
3. Kiểm tra **Explicit Allow**: Có ít nhất 1 lệnh cho phép (và không bị Permissions Boundary / SCP chặn) không? $\rightarrow$ Nếu **CÓ**, cho phép thực thi.

---

## 2. Mẫu Cấu hình Chuẩn & Lệnh Thực Hành

### A. Trust Policy (Ai được phép đội chiếc Role này?)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### B. Permissions Policy (Đội Role xong thì được phép làm gì?)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadMediaObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::my-app-media-bucket",
        "arn:aws:s3:::my-app-media-bucket/*"
      ]
    }
  ]
}
```

### C. Kiểm chứng nhanh trên EC2 bằng AWS CLI & Python SDK (`boto3`)
```bash
# Kiểm tra danh tính tạm thời EC2 đang mang
aws sts get-caller-identity

# Đọc S3 không cần aws configure
aws s3 ls s3://my-app-media-bucket/avatars/
```

```python
import boto3

# Boto3 tự động gọi EC2 Metadata (IMDSv2) lấy token từ IAM Role
s3 = boto3.client("s3", region_name="ap-southeast-1")
resp = s3.list_objects_v2(Bucket="my-app-media-bucket", Prefix="avatars/")
```

---

## 3. Luyện Thi DVA-C02: 3 Câu Hỏi Tình Huống Chuẩn Đề Thi

### Câu 1
Một công ty triển khai ứng dụng web chạy trên các máy chủ **Amazon EC2**. Ứng dụng cần đọc và ghi các tệp ảnh vào **Amazon S3** và lưu metadata vào **Amazon DynamoDB**. Developer muốn đảm bảo ứng dụng hoạt động bảo mật, không phải tự xoay vòng (rotate) khóa truy cập thủ công. Giải pháp nào đáp ứng đúng khuyến nghị của AWS?

- **A.** Tạo một IAM User có quyền S3 và DynamoDB, xuất Access Key rồi đặt vào biến môi trường của EC2.
- **B.** Tạo một **IAM Role** có gắn Policy truy cập S3 và DynamoDB, sau đó gắn Role này vào EC2 thông qua Instance Profile.
- **C.** Lưu Access Key và Secret Key của Root Account vào AWS Systems Manager Parameter Store dạng Plaintext và đọc khi khởi động app.
- **D.** Dùng một Inline Policy gắn trực tiếp vào EC2 Security Group để mở kết nối sang S3 và DynamoDB.

> **Đáp án đúng: B.**
> - **Giải thích:** Gắn IAM Role qua Instance Profile giúp EC2 tự động nhận **Temporary Security Credentials** từ **AWS STS** và tự xoay vòng định kỳ mà không cần lưu key tĩnh trên máy chủ.
> - **Tại sao các phương án khác sai?**
>   - **A:** Access Key của IAM User là thông tin xác thực dài hạn, dễ bị rò rỉ và phải tự xoay vòng thủ công.
>   - **C:** Tuyệt đối không bao giờ dùng Root Account credentials cho ứng dụng, càng không lưu Plaintext.
>   - **D:** Security Group là tường lửa mạng (IP/Port), không phải nơi gắn IAM Policy.

---

### Câu 2
Một IAM User tên `Minh` thuộc hai IAM Group là `Backend-Devs` và `S3-Admins`.
- Nhóm `Backend-Devs` được gắn Policy cho phép `s3:GetObject` và **Explicit Deny** hành động `s3:DeleteObject` trên bucket `company-logs`.
- Nhóm `S3-Admins` được gắn Managed Policy `AmazonS3FullAccess` (`s3:*` trên `*`).
Khi `Minh` chạy lệnh xóa một file trong bucket `company-logs`, kết quả sẽ là gì?

- **A.** Xóa thành công vì `AmazonS3FullAccess` có quyền rộng hơn.
- **B.** Xóa thành công vì `S3-Admins` có chữ cái sau nên được ưu tiên áp dụng cuối cùng.
- **C.** Thất bại với lỗi `AccessDenied` vì tồn tại một câu lệnh **Explicit Deny** khớp với hành động `s3:DeleteObject`.
- **D.** Thất bại với lỗi `ImplicitDeny` vì một User không thể thuộc đồng thời hai IAM Group.

> **Đáp án đúng: C.**
> - **Giải thích:** Theo quy tắc đánh giá IAM Policy của AWS, **một câu lệnh Explicit Deny luôn ghi đè mọi Explicit Allow** ở bất kỳ nhóm hay policy nào khác, bất kể thứ tự hay độ rộng của quyền Allow.
> - **Tại sao các phương án khác sai?**
>   - **A & B:** Không có khái niệm "quyền rộng hơn thắng" hay "thứ tự bảng chữ cái".
>   - **D:** Một IAM User hoàn toàn có thể thuộc nhiều IAM Group (tối đa 10 group mặc định), và lỗi xảy ra do **Explicit Deny**, không phải Implicit Deny.

---

### Câu 3
Developer viết một AWS Lambda function bằng Python (`boto3`) cần đọc các file từ một S3 Bucket riêng tư. Khi kiểm tra trong IAM Console, Developer thấy Role của Lambda đã gắn sẵn quyền `AmazonS3ReadOnlyAccess`, nhưng Lambda vẫn báo lỗi không thể đảm nhận (assume) được Role. Developer cần kiểm tra thành phần nào của IAM Role?

- **A.** Trust Policy của IAM Role phải có `Principal` là `"Service": "lambda.amazonaws.com"` với action `"sts:AssumeRole"`.
- **B.** Permissions Boundary của S3 Bucket.
- **C.** IAM Group chứa Lambda function.
- **D.** AWS Access Key ID gắn trong biến môi trường của Lambda.

> **Đáp án đúng: A.**
> - **Giải thích:** Để một dịch vụ AWS (như `lambda.amazonaws.com` hoặc `ec2.amazonaws.com`) có thể sử dụng IAM Role, **Trust Policy** của Role bắt buộc phải tin cậy chính dịch vụ đó và cho phép hành động `sts:AssumeRole`.
> - **Tại sao các phương án khác sai?**
>   - **B:** S3 Bucket không có Permissions Boundary; lỗi xảy ra ở bước **Assume Role** trước khi gọi S3.
>   - **C:** Dịch vụ Lambda không phải IAM User nên không thể bỏ vào IAM Group.
>   - **D:** Lambda chạy với Execution Role, không dùng Access Key tĩnh trong biến môi trường.
