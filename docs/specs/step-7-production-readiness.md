# Kora — Step 7: Public launch, identity, billing và kiểm soát chi phí

Ngày soạn: 2026-10-18  
Trạng thái: Đã triển khai local request guards và production generation kill switch; production identity/billing/limits còn chờ quyết định ở §12.  
Thư mục dự án: `D:\Project\Kora`  
Tài liệu liên quan: [Kora V1](../../kora_initial_spec.md); [Step 5 — AI parser evaluation](./step-5-ai-parser-evaluation.md); [Step 6 — V1 user experience](./step-6-v1-user-experience.md).

## 1. Mục tiêu

Đưa Kora từ app V1 chạy trong môi trường tin cậy sang public production mà người lạ không thể dùng API key của server để tạo chi phí không giới hạn. Người dùng phải có danh tính được xác thực, quyền sử dụng rõ ràng, giới hạn request thực thi ở server và trạng thái billing không phụ thuộc vào UI.

Step này hoàn tất khi có thể deploy một release có thể rollback; mọi request tạo kiến trúc đi qua authentication, entitlement, quota và rate limit phía server; usage được ghi nhận an toàn, có thể đối soát; secrets không rò qua browser, log hay artifact; và kiểm thử chứng minh các đường từ chối không gọi provider.

## 2. Phạm vi và ranh giới

### Trong phạm vi

- Public production deployment và môi trường staging tương ứng.
- Authentication/session cho người dùng cá nhân.
- Quyền sử dụng AI, quota, rate limit, giới hạn đồng thời và server-side cost controls.
- Metering request/token/cost và billing lifecycle nếu bật paid plan.
- Webhook billing an toàn, idempotent; trạng thái entitlement nhất quán với server.
- Privacy, secrets, abuse controls, observability, rollback và runbook.
- Test integration/security dùng fake provider hoặc sandbox; không phát sinh charge thật trong test.

### Ngoài phạm vi

- Cloud sync, lưu diagram/prompt trên server, project library, collaboration hoặc chia sẻ workspace. Document tiếp tục local-first theo Step 2/6.
- Thêm provider AI, advisor, RAG, fine-tuning hoặc thay đổi semantic contract của parser.
- Mở rộng catalog AWS, tư vấn kiến trúc, scan tài khoản AWS hoặc infrastructure-as-code.
- Đặt giá, cam kết SLA, thuế, hoàn tiền hoặc điều khoản pháp lý thay cho quyết định sản phẩm/chủ sở hữu.
- Tự chạy live provider smoke hay giao dịch thanh toán thật trong test/deploy.

Authentication và billing không được dùng làm lý do serialize prompt, API key, diagram hay session vào Document/localStorage.

## 3. Hiện trạng cần xử lý

| Thành phần | Hiện trạng đã thấy trong source | Hệ quả |
| --- | --- | --- |
| `src/app/api/parse-architecture/route.ts` | Trước P7: `POST` chưa xác thực; nhận `apiKey` từ request body hoặc dùng server env. Hiện `NODE_ENV=production` trả `503 PUBLIC_LAUNCH_NOT_CONFIGURED` trước khi parse body/tạo parser; local request dùng schema strict, cap 64 KiB và prompt tối đa 20.000 ký tự | Public generation đang fail closed; local app vẫn test được. Chưa có authentication, entitlement, ledger hay distributed limiter |
| `src/core/ai/providers/deepseek.parser.ts` | Gọi DeepSeek bằng key server-side, có deadline/AbortSignal và model từ env | Giữ adapter; thêm policy trước khi tạo parser/provider request |
| `src/components/prompt/PromptHeader.tsx` | Gọi endpoint cùng origin | Không gọi provider trực tiếp từ browser khi dùng managed key |
| Document/storage Step 2/6 | Lưu một diagram local; không có server-side account document store | Giữ diagram và prompt ngoài backend persistence |
| `package.json` / app config | Next.js app, chưa có auth/billing/database/rate-limit adapter | Không giả định một vendor đã được chọn; phải chọn trước khi tích hợp production |

Không đọc hoặc ghi giá trị trong `.env.local`. Mọi bằng chứng test phải tránh in credential hoặc prompt vào log.

### Implementation slice hiện có

- `src/core/server/publicGenerationGate.ts` khóa generation trên runtime production; không có env flag để vô hiệu hóa guard khi auth/cost controls chưa tích hợp.
- `src/core/server/boundedJsonBody.ts` đọc request theo stream với giới hạn byte, từ chối payload quá cỡ và UTF-8 lỗi.
- `src/core/server/localGenerationLimiter.ts` giới hạn local development ở 5 request/phút và 1 generation đồng thời; đây chỉ là guard local trong process, không thay thế limiter dùng shared store của production.
- `src/app/api/health/route.ts` trả readiness động, không cache: local/test trả `200`; production hiện trả `503 not_ready` cho tới khi public launch controls được triển khai, không trả thông tin env.
- `scripts/test-bounded-json-body.mjs` kiểm tra giới hạn body, encoding và production gate; chạy bằng `npm run test:server-guards`. Script dev mặc định dùng Webpack (`npm run dev`) để làm việc trên máy đang chặn native SWC; Turbopack vẫn có lệnh riêng `npm run dev:turbo`. Local route trả 400 với field lạ và 413 với body vượt 64 KiB; local homepage đã được mở ở `http://127.0.0.1:3000`.
- Đây là đường cho local testing và trạng thái production an toàn tạm thời, chưa phải public launch hoàn tất theo §13.

## 4. Kiến trúc đích

```text
Browser
  ├─ Auth session (secure cookie)
  ├─ Local Document, prompt draft và export
  └─ POST /api/parse-architecture
       ├─ body/schema/size validation
       ├─ authenticate + CSRF/origin check
       ├─ entitlement check
       ├─ atomic quota reservation + distributed rate/concurrency limit
       ├─ DeepSeek adapter (server credential hoặc BYOK nếu policy cho phép)
       └─ settle usage ledger; trả kết quả đã sanitize

Billing provider webhook ──> verify signature ──> idempotent event inbox
                                             └─> update subscription entitlement
```

Route handler chỉ điều phối. Tạo interface nhỏ trong core cho `AuthService`, `EntitlementService`, `UsageLedger`, `RateLimiter` và `BillingProvider`; implementation production dùng shared persistent storage/atomic operations, không dùng Map trong process hoặc state của một serverless instance. Provider SDK/adapter không được import vào browser bundle.

Auth, billing và quota phải được kiểm tra ngay trong cùng server request trước khi tạo `DeepSeekArchitectureParser` hoặc gửi request upstream. Không tin vào plan/role/usage được client gửi lên.

## 5. Authentication và session

- Mọi route tạo chi phí yêu cầu session hợp lệ; UI ẩn nút Generate không thay thế server check.
- Session cookie dùng `HttpOnly`, `Secure` trên production, `SameSite=Lax` hoặc chặt hơn theo auth flow, path/domain hẹp và thời hạn có thể cấu hình. Session hết hạn/revoke phải bị từ chối ở server.
- Với cookie-authenticated POST, kiểm tra `Origin`/CSRF theo auth framework; request sai origin bị từ chối trước quota reservation/provider.
- Chỉ trả user identifier tối thiểu cho client. Không expose access token, refresh token, provider secret hoặc billing provider secret trong response.
- Logout làm session mất hiệu lực; đổi mật khẩu/thu hồi session tuân theo capability của identity provider đã chọn.
- Dev/test bypass chỉ được bật explicit trong môi trường local/test; production phải fail closed nếu auth chưa cấu hình. Không có default admin/password.
- Giới hạn request body trước khi parse JSON; validate prompt, scope và fields được phép. Bỏ `.passthrough()` hoặc dùng allowlist để field lạ như `plan`, `userId`, `apiKey` không âm thầm ảnh hưởng policy.

## 6. Quyền sử dụng, quota và rate limit

- Policy chạy server-side theo authenticated account và deployment environment.
- Mỗi generation phải reserve usage atomically trước provider call; nếu reserve thất bại, trả lỗi có mã ổn định và không gửi request upstream.
- Áp dụng đồng thời: quota theo cửa sổ billing, request rate theo account, burst/IP limit cho login và auth endpoints, giới hạn số generation đang chạy trên account. Rate limiter phải dùng store chia sẻ giữa instances và chống race khi request song song.
- Định nghĩa cấu hình rõ ràng cho `maxRequestBytes`, `maxPromptLength`, `maxRequestsPerMinute`, `maxConcurrentGenerations`, `monthlyIncludedCredits`, provider timeout và global spend ceiling. Có giá trị staging/prod tách biệt; không dựa vào một giới hạn chỉ ở client.
- Prompt không rỗng, scope allowlist/length; body vượt cap trả `413`, request sai schema `400`, chưa đăng nhập `401`, hết entitlement/quota `402` hoặc mã lỗi app tương đương đã document, rate limited `429` kèm `Retry-After`.
- Giữ timeout 90 giây của provider adapter làm trần; tổng deadline của route phải kết thúc sớm hơn platform execution limit. Client abort/timeout không được bỏ sót việc settle reservation.
- Retry từ UI không được tự lặp request khi lỗi mơ hồ; yêu cầu một idempotency key theo generation attempt. Cùng user + key trả kết quả/trạng thái đã ghi nhận thay vì gọi AI lần nữa.
- Giới hạn tổng chi tiêu theo deployment/account phải có hard stop có thể cấu hình và cảnh báo trước ngưỡng; khi chạm hard stop, từ chối request mới trước provider.

Các giá trị numeric cuối cùng phải được owner phê duyệt trong cấu hình production; không hardcode giá/plan vào component UI hoặc spec test.

## 7. Usage ledger và billing

- Ledger ghi `accountId`, request/idempotency ID, provider, requested/returned model, thời điểm, trạng thái reservation/settlement, token usage nếu provider trả về, đơn vị quota đã tính và correlation ID. Không ghi prompt, diagram, API key hoặc raw provider body.
- Trạng thái tối thiểu: `RESERVED`, `SETTLED`, `RELEASED`, `UNKNOWN`. Mọi transition idempotent. Nếu request chưa được gửi, release reservation; nếu provider hoàn tất, settle theo usage; nếu timeout/mất kết nối sau khi gửi và không biết provider đã tính phí hay chưa, đánh dấu `UNKNOWN`, áp dụng policy bảo thủ và đưa vào đối soát. Không tự phát request retry để “sửa” trạng thái đó.
- Provider usage thiếu thì ghi rõ `usage unavailable`; dùng ước lượng chỉ khi policy đã định nghĩa, luôn lưu loại nguồn (`provider-reported`/`estimated`) và không trình bày estimate như usage thực tế.
- Subscription/plan/credit là server-owned entitlement. Response từ billing redirect, client state hoặc webhook chưa verify không cấp quyền.
- Billing webhook verify chữ ký trên raw body, giới hạn kích thước, dedupe theo event ID, xử lý duplicate/out-of-order, ghi nhận event trước khi side effect và cho phép retry an toàn. Không làm mất entitlement do webhook transient failure; có reconciliation job/report.
- UI có thể hiển thị usage/quota còn lại và trạng thái subscription từ endpoint read-only. Không hiển thị “đã thanh toán” chỉ dựa trên redirect thành công.
- Chưa có quyết định giá hoặc billing vendor trong repo. Billing adapter phải hỗ trợ sandbox và test signature; production paid plan chỉ mở khi vendor, plan catalog, cancel/dunning/refund behavior và legal copy đã được chốt.

## 8. Provider key và privacy

- Production server key chỉ nằm trong secret manager/environment của runtime, không prefix `NEXT_PUBLIC_`, không serialize vào client, build artifact, source map, log hay error response.
- Nếu giữ BYOK: key chỉ được gửi qua TLS trong generation request, không persist ở backend, ledger, analytics, URL, crash report hoặc local Document; che mọi header/body liên quan khỏi logs. BYOK request vẫn phải qua auth, rate limit, abuse checks và spend policy. Chính sách quota/billing của BYOK phải nhất quán, document cho người dùng và không thể chọn bằng client field tùy ý.
- Nếu bỏ BYOK cho public launch, xóa đường nhận key từ request body và dùng secret server-side sau entitlement; không giữ một fallback mơ hồ giữa BYOK và managed key.
- Không log prompt/response/diagram theo mặc định. Telemetry chỉ ghi event code, duration, provider status/model, usage metadata tối thiểu và correlation ID. Có retention ngắn/cấu hình được và quyền truy cập giới hạn.
- Error response chỉ chứa public code/message. Provider exceptions, secret, response body, stack trace và auth token không được trả cho client.
- Public routes đặt body-size cap; security headers/CSP/frame policy và dependency audit được cấu hình theo hosting/runtime đã chọn.

## 9. Deployment, vận hành và rollback

- Có local, staging và production settings tách biệt; staging dùng provider/billing sandbox hoặc fake adapters. Production secrets không được copy sang preview deployments.
- CI chạy typecheck, lint, unit/integration tests, build và dependency/security checks trước deploy. Production rollout có health check, smoke test không phát sinh AI/billing charge, và rollback về artifact trước đó.
- Có health/readiness endpoint không tiết lộ env/config; readiness báo unavailable nếu auth, shared rate-limit store hoặc entitlement/ledger dependency bắt buộc chưa sẵn sàng.
- Structured logs có request/correlation ID và mã trạng thái; metrics/alerts tối thiểu cho provider error/timeout, `429`, quota denial, unknown settlements, webhook backlog, auth failure spike và daily spend. Không gắn PII/prompt/key làm metric label.
- Có runbook cho secret rotation, provider outage, billing webhook backlog, spend hard-stop, account abuse, rollback và data reconciliation.
- Không chạy database migration destructive trong deployment tự động. Migration phải backward-compatible với rolling deploy và có backup/restore plan nếu hệ thống lưu account/billing records.

## 10. Kiểm thử và nghiệm thu

| ID | Kiểm tra | Kết quả bắt buộc |
| --- | --- | --- |
| S01 | POST không session / session expired | `401`; provider fetch count bằng 0 |
| S02 | Origin/CSRF không hợp lệ | Từ chối trước reservation; provider fetch count bằng 0 |
| S03 | Body lớn, field lạ, prompt/scope sai | Từ chối bằng code/status đã định; không ghi raw body |
| S04 | Account hết quota, entitlement bị pause hoặc global hard-stop | Từ chối trước provider; ledger không âm/không duplicate |
| S05 | Rate/concurrency vượt ngưỡng trên nhiều instance giả lập | Store atomic; request dư nhận `429`/quota code, không có oversubscription |
| S06 | Request song song cùng idempotency key | Chỉ tối đa một provider call; response còn lại đọc cùng trạng thái |
| S07 | Provider success/error/429/timeout/client abort | Settlement/release/unknown đúng policy; không log credential/prompt |
| S08 | BYOK mode (nếu giữ) | Key không được persist, log, trả lại hoặc đưa vào ledger; account controls vẫn áp dụng |
| S09 | Billing webhook sai chữ ký/duplicate/out-of-order | Sai chữ ký bị từ chối; event hợp lệ idempotent; entitlement cuối nhất quán |
| S10 | Auth/session revoke, logout và client tampering plan/userId | Server từ chối hoặc bỏ qua field giả mạo |
| S11 | Production configuration thiếu auth/ledger/rate-limit secret | App fail closed/readiness fail; không phục vụ managed provider key công khai |
| S12 | Staging deploy/rollback | Health/smoke pass không gọi AI; artifact cũ có thể phục hồi |

Test dùng fake clock, fake provider, fake auth, test ledger và billing sandbox. Mỗi test khẳng định cả HTTP result, ledger transition và provider-call count. Live provider/billing tests phải là lệnh riêng, có request/spend budget hiển thị và không chạy trong CI mặc định.

## 11. Các mốc triển khai

1. **Boundary:** quyết định auth/deployment/storage/billing và threat model; thêm interfaces + config validation; test fail-closed.
2. **Identity:** tích hợp login/session; khóa API route; kiểm tra origin/CSRF, logout và revoke.
3. **Abuse/cost controls:** shared limiter, atomic reservations, idempotency, limits và provider-call tests.
4. **Usage/billing:** ledger, entitlement read path, sandbox webhook, duplicate/out-of-order/reconciliation tests; chỉ bật paid flow sau khi plan được duyệt.
5. **Production readiness:** secret management, alerts/runbooks, CI/deploy/rollback, staging acceptance và security review.
6. **Launch gate:** chạy Step 5/6 required regressions; thực hiện live smoke có budget được chủ động cấp; ghi provider/model, usage và kết quả; mở traffic theo rollout có thể rollback.

## 12. Quyết định phải chốt trước khi code production

Repo hiện chưa xác định các mục sau; spec không tự đặt thay owner:

1. Hosting/runtime cho public app và nơi giữ secrets.
2. Identity provider, login method và account recovery policy.
3. Persistent store cho account, entitlement, usage ledger, webhook inbox và shared rate limits; yêu cầu backup/retention.
4. Managed-key, BYOK hoặc cả hai; quota/billing policy riêng cho từng mode.
5. Billing provider, plan/credit catalog, trial, cancellation, failed payment, refund và legal copy.
6. Numeric prompt/body, rate, concurrency, quota, retention và global spend limits.

Mặc định an toàn đến khi các quyết định được chốt: public deployment không bật endpoint tạo AI; production thiếu bất kỳ dependency bắt buộc nào phải fail closed; không lưu prompt/diagram trên server; không chạy live provider hoặc payment trong test tự động.

## 13. Điều kiện hoàn tất

- [ ] Auth được xác thực ở server và mọi generation route đều fail closed khi thiếu cấu hình.
- [ ] Quota/rate/concurrency/global spend enforcement dùng shared atomic state và có test race.
- [ ] Idempotency, ledger settlement và trạng thái request không chắc chắn có audit/reconciliation path.
- [ ] Provider/BYOK secrets và prompt/diagram không xuất hiện trong browser bundle, logs, telemetry hoặc errors.
- [ ] Billing webhook sandbox được verify, dedupe, replay-safe và cập nhật entitlement đúng thứ tự.
- [ ] Production/staging deploy, health checks, rollback, alerts và runbook được nghiệm thu.
- [ ] Security/integration tests pass; mọi denial test chứng minh không có provider call.
- [ ] Live spend smoke được chạy riêng với budget được phê duyệt và được ghi nhận; không dùng offline harness làm bằng chứng.
- [ ] Các mục còn mở của Step 5/6 được báo cáo riêng; auth/deployment không tự đóng browser acceptance hoặc parser quality gate.
