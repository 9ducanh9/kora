# Kora — Step 5: Đo chất lượng AI parser

Ngày soạn: 2026-10-17  
Trạng thái: Đã triển khai evaluator/harness; offline validation pass; live baseline chưa chạy. Xem [báo cáo thực hiện Step 5–6](../experience/20261018-104520/report.md).  
Thư mục dự án: `D:\Project\Kora`  
Tài liệu liên quan: [Kora V1](../../kora_initial_spec.md), mục 2–4, 6–11 và 22–26; [Step 1 — Baseline](./step-1-v1-baseline.md); [Step 2 — Validation](./step-2-document-validation.md); [Step 3 — Editor](./step-3-editor-transactions.md); [Step 4 — Layout/routing](./step-4-layout-routing.md).

## 1. Mục tiêu

Đo mức độ parser giữ đúng kiến trúc mà người dùng mô tả. Sau bước này phải biết parser thiếu/thừa service nào, nhầm instance nào, mất đường nối/label nào, hoặc tự suy diễn membership ở đâu. Khi thay system prompt hoặc adapter, có thể chạy lại cùng bộ case và thấy regression cụ thể.

Các kết quả bắt buộc:

1. Bộ **16 prompt** có input, context và expected semantics độc lập với output của provider.
2. Matcher xác định, không phụ thuộc ID hoặc thứ tự array mà AI sinh ra.
3. Chấm nodes, assets, containers, edges có hướng, labels, scope và membership; giữ được nhiều instance cùng service hoặc cùng tên.
4. Phân biệt lỗi transport, JSON/schema, semantic fidelity và downstream pipeline. Model hợp lệ chưa có nghĩa là kiến trúc đúng.
5. Offline tests chứng minh evaluator bắt được lỗi; live baseline ghi đúng provider/model/config và mọi lần thử.
6. Báo cáo theo case và diff giữa hai run, kèm backlog lỗi parser có thể tái kiểm tra.

**Step 5 là bước đo chất lượng.** Một live baseline chỉ ra parser chưa đạt mục tiêu vẫn là kết quả có ích và có thể hoàn tất phần đo nếu bằng chứng đầy đủ. Không mở rộng thành yêu cầu sửa mọi lỗi AI trước khi được ghi nhận baseline.

## 2. Phạm vi và phụ thuộc

### Trong phạm vi

- Corpus EN/VI, oracle có version, matcher, metrics, mutation tests và CLI chạy offline/replay/live.
- Dùng adapter DeepSeek của sản phẩm để đo provider chính; Gemini là lượt so sánh riêng nếu được chọn.
- Test seam nhỏ để fake transport, chụp observation an toàn và chấm đúng output trước normalization.
- Deadline/request budget của CLI đánh giá; artifact, comparison report và regression policy.
- Smoke qua API/pipeline để kiểm tra adapter thật sự đang được dùng, khi môi trường cho phép.

### Ngoài phạm vi

- Thiết kế lại kiến trúc AWS, tư vấn best practices hoặc tự thêm hạ tầng.
- Thêm provider, agent, RAG, fine-tuning, LLM judge hoặc dịch vụ eval bên ngoài.
- Sửa layout/editor, export ảnh, autosave, lưu prompt vào Document hoặc UX cancel/retry. Các mục UX thuộc Step 6.
- Public deployment, auth, rate limit và quản lý chi phí nhiều người dùng. Các mục đó thuộc Step 7.
- Tự chạy live provider khi chạy test thông thường, tự chuyển sang mock, hoặc bắt test unit phải có credential.

Đọc lại source và báo cáo Step 1–4 trước khi triển khai. Hiện Step 2–4 có offline evidence, nhưng build/browser acceptance còn thiếu vì SWC bị Windows Application Control chặn. CLI/parser-only tests phải chạy độc lập với Next server; kết quả Step 5 không đóng các mục browser còn mở của các bước trước.

## 3. Hiện trạng đã đọc

| Nguồn | Hiện trạng | Hệ quả cho Step 5 |
| --- | --- | --- |
| `src/core/ai/parser.interface.ts` | `parse(prompt, context?)` trả `{ model, issues }`; lỗi chuẩn `ArchitectureParseError` | Tái sử dụng abstraction; không gọi provider từ matcher |
| `src/core/ai/providers/deepseek.parser.ts` | `fetch`, JSON mode, temperature `0.1`; model mặc định `deepseek-chat`, có override; JSON parse rồi validate | Ghi config thực tế, không lấy tên hiển thị `DeepSeek (V3)` làm bằng chứng model đã phục vụ |
| `src/core/ai/providers/gemini.parser.ts` | Adapter riêng dùng cùng system prompt; mặc định `gemini-2.5-flash`; không nằm trên API hiện tại | Không tự chuyển sang Gemini khi DeepSeek lỗi |
| `src/app/api/parse-architecture/route.ts` | API sản phẩm dùng DeepSeek; trả `model`, `issues`, `parser` | Smoke đúng `/api/parse-architecture`; không tạo endpoint eval public |
| `src/core/ai/systemPrompt.ts` | Đã yêu cầu giữ intent, không thêm services/placement; có catalog và output example cố định | Đo nguy cơ ví dụ làm xuất hiện service/group không được yêu cầu; chưa coi đó là lỗi AI đã quan sát |
| `src/core/ir/validator.ts` | Strict schema/references; canonicalize asset alias; unknown/missing asset có thể chỉ warning | Schema pass và asset correctness là hai chỉ số riêng |
| `src/core/pipeline/generationPipeline.ts` | Validate → prepare → measure/layout → Document; `rawCounts` hiện đếm model đã validate | Không dùng `rawCounts` làm raw provider evidence |
| `src/core/architecture/prepareModel.ts` | Có thể thêm Cloud và gán AWS roots vào Cloud | Chấm parser trước bước này để không che mất suy diễn membership |
| `scripts/test-parser.ts` | Có thể chạy Gemini hoặc mock tùy credential; một số kiểm tra chỉ warning | Không dùng log “ALL TESTS PASSED” làm điểm parser |
| `scripts/test-deepseek.ts` | Tự đọc `.env.local`; catch có nhánh chỉ log lỗi | Viết runner riêng, mode explicit và exit code rõ; không dùng script này làm acceptance gate |
| Baseline/golden/Quick Test | Chủ yếu dùng IR fixture hoặc canned response | Chứng minh downstream preservation/harness; không chứng minh natural-language extraction |

Giữ hai adapter và API hiện có. Chưa cần đổi model, SDK hay dependency để xây bộ đo.

## 4. Ranh giới dữ liệu và phép đo

```text
Frozen prompt + context ──→ production parser adapter ──→ parser IR + issues
                                  │                              │
                         provider observation             semantic evaluator
                                                                 ↑
Frozen oracle ────────────────────────────────────────────────────┘

parser IR ──→ prepare/layout/Document  (downstream check riêng)
```

- Oracle không được gửi cho provider, đưa vào system prompt, hoặc sinh từ chính output đang chấm.
- Input live giữ nguyên prompt/context đã freeze. Chỉ system prompt/config sản phẩm được khai báo cho run mới đi vào adapter.
- `parser-ir.json` là model adapter trả về **sau validation/canonicalization của adapter, trước `prepareArchitectureModel`**. Không gọi nó là raw response.
- Nếu cần quan sát trước validation, thêm observer chỉ cho runner/server tests: ghi content JSON/text, model/finish reason/usage nếu có và kết quả validation. Không đưa observer hay raw content vào Document/UI API.
- `provider-output.txt/json` là dữ liệu không tin cậy. Không execute nội dung, render HTML hoặc lấy lời chỉ dẫn trong đó làm lệnh cho runner.
- Ghi riêng asset resolution ban đầu/canonicalized/label-derived/fallback. Không sửa `assetId` thiếu bằng một giá trị suy ra rồi báo parser đã trả đúng asset.
- Không repair, dedup, normalize Cloud, đổi hướng edge hoặc tự thêm label để làm output pass matcher.
- Khi JSON/model invalid, lưu code/path và observation nếu có; không chạy layout để cứu output. Không gán semantic score bằng 100 cho trường hợp không chấm được.

## 5. Corpus và oracle

### 5.1. Quy tắc chung

Chốt **P01–P16**, gồm 12 case phát triển và 4 case kiểm tra riêng P13–P16. Tất cả prompt phải được lưu nguyên văn và có SHA-256; expected graph cần được đọc/rà độc lập từ prompt trước lần chạy live đầu tiên.

Ký hiệu dưới đây dùng role keys của evaluator, không phải ID bắt AI trả:

- `role: asset` là một node riêng. Tên đặt trong dấu nháy là custom label cần giữ; service name thông thường dùng danh sách alias đã chốt.
- `child → parent` trong dòng boundary/membership là quan hệ chứa; trong dòng **Edges** là connection có hướng. Không chuyển membership thành edge.
- `a → b [label]` yêu cầu một edge và label đó; label path/token giữ nguyên ký tự. Không có `[label]` nghĩa là label `ANY`, không bắt provider bịa `Forward`/`State` theo fixture cũ.
- Mọi node/container không được chỉ định membership/parent có expectation `ABSENT` trong parser IR, trừ khi case ghi khác. Mọi entity/edge ngoài inventory là extra.
- Chỉ yêu cầu `relationship` khi prompt nêu rõ lớp quan hệ hoặc oracle khai báo một equivalence đã duyệt. Không lấy quyết định tùy ý của fixture cũ làm chân lý.
- Cloud chỉ nằm trong raw oracle nếu prompt yêu cầu. Cloud do parser thêm khi không được yêu cầu vẫn được ghi `EXTRA_CONTAINER` với subtype `implicit-cloud`; `origin: system` do AI tự trả không miễn lỗi. Cloud do Kora thêm sau parse được báo riêng ở downstream stage.
- Không dùng container/asset ID cố định của baseline làm expected provider IDs. B1–B3 hiện có system Cloud và vài label fixture không có trong prompt, cần viết oracle parser riêng.

### 5.2. P01–P08

**P01 — Static delivery, EN.**

> Draw an overall architecture with only these components: Users, CloudFront, and one S3 bucket named Frontend Assets. Users access CloudFront over HTTPS. CloudFront routes /assets/* to Frontend Assets. Do not add any boundaries or other services.

Nodes: `users: external.user`, `cdn: aws.cloudfront`, `assets: aws.s3 ("Frontend Assets")`. Containers: không có. Edges: `users → cdn [HTTPS]`, `cdn → assets [/assets/*]`. Scope: `overall-architecture`.

**P02 — First end-to-end architecture, EN, critical.**

Dùng nguyên prompt B2 ở Step 1: Users → CloudFront; `/assets/*` → S3; `/api/*` → ALB; ALB → ECS Fargate; ECS trong private subnet của VPC và dùng DynamoDB.

Nodes: Users, CloudFront, S3, ALB, ECS Fargate, DynamoDB với asset tương ứng. Containers: VPC và private subnet; subnet → VPC. ECS → subnet; Users/CloudFront/S3/ALB/DynamoDB không có `containerId`; VPC không có `parentId`. Edges: năm quan hệ trong prompt, bắt `HTTPS`, `/assets/*`, `/api/*`; hai label còn lại `ANY`. Không thêm NAT/WAF/Region/AZ hoặc tự đặt ALB vào VPC. Fixture phải copy nguyên văn B2, không chỉ lưu bản tóm tắt này.

**P03 — Hai backend độc lập, EN, critical.**

Copy nguyên prompt B3 ở Step 1, gồm hai tên `Backend A`, `Backend B`, hai private subnet và Users ngoài AWS Cloud, rồi thêm câu sau vào input gửi provider: **"VPC Main is directly inside AWS Cloud."** B3 gốc chưa khai báo parent này; không được chỉ thêm vào oracle rồi tính parser sai.

Nodes: 7 role riêng, hai backend đều `aws.ecs.fargate`; còn lại Users/CloudFront/S3/ALB/DynamoDB. Raw containers: AWS Cloud, VPC Main, Private Subnet A, Private Subnet B. VPC → Cloud; hai subnet → VPC; mỗi backend → subnet cùng tên; CloudFront/S3/ALB/DynamoDB → Cloud; Users membership `ABSENT`. Edges: Users → CloudFront, CloudFront → S3/ALB, ALB → từng backend, từng backend → cùng DynamoDB. Chỉ bắt các label được prompt nêu. Cấm Region/AZ và gộp hai backend.

**P04 — Bản tiếng Việt của P03.**

> Vẽ kiến trúc tổng thể gồm Users ở ngoài AWS Cloud. CloudFront, S3 bucket, ALB và một DynamoDB table nằm trực tiếp trong AWS Cloud, ngoài VPC Main. VPC Main cũng nằm trực tiếp trong AWS Cloud. Users truy cập CloudFront bằng HTTPS. CloudFront chuyển /assets/* đến S3 và /api/* đến ALB. VPC Main chứa Private Subnet A và Private Subnet B. Có hai service ECS Fargate riêng biệt, giữ tên Backend A và Backend B: A thuộc subnet A, B thuộc subnet B. ALB chuyển yêu cầu đến cả hai backend; mỗi backend dùng chung DynamoDB table đó. Không thêm Region hoặc Availability Zone.

Oracle graph/membership như P03; label aliases ngôn ngữ được chốt trước. Chấm riêng từng case, rồi báo độ nhất quán EN/VI theo role graph; không bắt ID/title giống nhau.

**P05 — Route paths và parallel edges, EN, critical.**

> Draw Users, CloudFront, S3 named Frontend Assets, Lambda named Wake Function, one ALB named Backend ALB, and ECS Fargate named Backend. Use separate connections with exactly these labels: Users to CloudFront: HTTPS; CloudFront to Frontend Assets: /assets/*; CloudFront to Wake Function: /api/wake; CloudFront to Backend ALB: /api/*; CloudFront to the same Backend ALB: /ws/* (WebSocket); Backend ALB to Backend: Forward. Wake Function is invoked through a Lambda Function URL, not API Gateway. Do not add boundaries or other components.

Nodes: 6, Lambda dùng `aws.lambda`, không tạo service “Function URL” riêng. Edges: 6, trong đó hai edge CloudFront → cùng ALB phải tồn tại độc lập với hai label khác nhau. Bắt đủ path và token `WebSocket`; cấm API Gateway và gộp hai routes thành một label chung.

**P06 — Scope chỉ gồm data flow, VI, critical.**

> Hệ thống đầy đủ còn có CloudFront, ALB, S3 và WAF, nhưng lần này chỉ vẽ luồng live caption sau: Users gửi PCM Audio đến Backend chạy ECS Fargate. Backend gửi PCM Audio đến Transcribe; Transcribe trả Transcript về Backend. Backend gửi Text đến Translate; Translate trả Translation về Backend. Backend gửi Captions về Users. Chỉ giữ bốn thành phần trong luồng này, không vẽ các dịch vụ nền hoặc boundaries. Giữ các label đúng như các cụm tiếng Anh vừa nêu.

Context: `scope: "data-flow"`; expected scope `data-flow`. Nodes: Users, Backend, Transcribe, Translate. Edges: 6 có hướng và labels như prompt. Cấm CloudFront/ALB/S3/WAF, tự thêm DynamoDB/NAT và các edges ngoài scope.

**P07 — Cardinality và không thêm best practices, EN, critical.**

> Draw VPC Main with Public Subnet and Private Subnet. Put exactly one NAT Gateway named Egress NAT in Public Subnet and exactly one EC2 instance named Worker in Private Subnet. Add only Worker to Egress NAT with label HTTPS. Do not add AWS Cloud, Region, Availability Zones, Internet Gateway, WAF, load balancers, endpoints, databases, or extra NAT Gateways.

Nodes: `nat: aws.vpc.nat-gateway`, `worker: aws.ec2`. Containers: 3; hai subnet → VPC. Node memberships đúng hai subnet. Một edge Worker → NAT `[HTTPS]`. Mọi entity thừa đều fail, kể cả NAT thứ hai cùng asset.

**P08 — Nhắc đến nhưng đã loại khỏi scope, VI, critical.**

> Chỉ vẽ bốn node: Users, API Gateway tên Public API, Lambda tên Request Handler và DynamoDB tên State Table. Nối Users → Public API với label HTTPS, Public API → Request Handler với label Invoke, Request Handler → State Table với label State. SQS đã tắt và không thuộc diagram; ECS, RDS và cache chỉ là phương án cũ, không được vẽ. Không thêm container.

Nodes: 4, edges: 3, labels chính xác; containers: 0. Forbidden predicates kiểm tra SQS/ECS/RDS/ElastiCache trên toàn output, kể cả node generic đổi tên để né asset matching.

### 5.3. P09–P16

**P09 — Boundary sâu và subnet rỗng, VI.**

> Vẽ AWS Cloud chứa Region us-east-1. Region chứa VPC Main. VPC Main chứa AZ A và AZ B. AZ A chứa Private Subnet A; AZ B chứa Private Subnet B và Reserved Subnet. Worker A và Worker B là hai Lambda riêng: A thuộc Private Subnet A, B thuộc Private Subnet B. Reserved Subnet là private subnet rỗng. Chỉ nối Worker A → Worker B với label Job, relationship event. Không thêm service hoặc boundary khác.

Nodes: 2 Lambda. Containers: 8, tính cả Cloud/Region/VPC/hai AZ/ba subnet. Parent/membership như prompt; Reserved Subnet không có descendant node. Một edge `event`, label `Job`. Không được biến boundary rỗng thành node.

**P10 — Cùng asset, cùng label, khác nhóm, EN, critical.**

> Draw two separate logical groups named Ingest and Export. Each group contains one SQS queue labeled Work Queue and one Lambda labeled Worker. Inside each group, connect its Work Queue to its Worker with label Job and relationship event. Keep the same labels in both groups. The two queues and two workers are distinct instances. Add no cross-group connections, additional groups, infrastructure boundaries, or other services.

Nodes: 4; containers: 2 `generic-group` với parent `ABSENT`; edges: 2. Role keys `ingestQueue`, `exportQueue`, `ingestWorker`, `exportWorker`; identity discriminator là named group được prompt nêu. Không dedup theo label/asset hoặc cho một actual node khớp hai role.

**P11 — External và generic có chủ đích, VI.**

> Vẽ ba thành phần không có container: Stripe là external third-party payment provider; Billing API là ứng dụng nội bộ generic; Bộ ghép âm thanh là component generic tự viết, không phải dịch vụ AWS. Nối Stripe → Billing API với label Webhook; Billing API → Bộ ghép âm thanh với label Job. Giữ nguyên ba tên này, không thay các component tự viết bằng dịch vụ AWS.

Assets: `external.third-party`, `generic.component`, `generic.component`; kinds external/generic tương ứng. Hai edges như prompt. Generic có chủ đích là đúng; không tính nó thành asset fallback lỗi. Chưa có asset cụ thể không cho phép bịa `aws.billing-api` hoặc `aws.audio-mux`.

**P12 — Viết tắt và diễn đạt tương đương P02, VI.**

> Users truy cập Amazon CloudFront qua HTTPS. CloudFront chuyển /assets/* tới private S3 bucket và /api/* tới Application Load Balancer (ALB). ALB chuyển tới ECS chạy bằng Fargate. Chỉ ECS được đặt trong một private subnet thuộc một VPC; vị trí các service còn lại không được chỉ định. ECS ghi trạng thái ứng dụng vào DynamoDB. Không thêm service hoặc boundaries ngoài VPC và private subnet đã nêu.

Oracle semantics như P02. `aws.ecs` đơn thuần không thay được `aws.ecs.fargate`; alias `aws.fargate` có thể canonicalize theo registry nhưng phải ghi nguồn alias. Không bắt label tự đặt `Forward`/`State`. Báo riêng consistency P02/P12.

**P13 — Self-loop và reciprocal edges, EN, kiểm tra riêng.**

> Draw Client as a generic application and Worker as a Lambda. Add exactly three directed connections: Client to Worker labeled Request with relationship request; Worker to Client labeled Response with relationship data; Worker to itself labeled Retry with relationship event. Do not add containers or other entities.

Nodes: 2, edges: 3, containers: 0. Label, direction và relationship đều bắt buộc. Self-loop không được loại bỏ; hai chiều không được gộp thành một edge vô hướng.

**P14 — Đổi thứ tự mô tả, EN, kiểm tra riêng.**

Tạo variant của P03 đã có câu làm rõ `VPC Main is directly inside AWS Cloud` bằng cách đưa các câu về DynamoDB và backend/subnet lên trước phần Users/CloudFront/ALB. Chỉ thay thứ tự các câu hoàn chỉnh, giữ nguyên mọi từ và yêu cầu; lưu nguyên prompt variant trong fixture. Oracle dùng cùng role graph P03, không copy output provider. Case này kiểm tra độ nhạy với thứ tự, không phải test determinism của LLM.

**P15 — ServiceGremlin dài, EN, kiểm tra riêng.**

Copy nguyên văn `tests/fixtures/servicegremlin.prompt.txt` thành fixture riêng và thêm đoạn làm rõ sau vào **input gửi provider**, không chỉ vào oracle:

> The two API Gateway occurrences labeled ServiceGremlin API are two distinct instances. The instance inside Client API is the source of the CloudWatch and Systems Manager connections. The instance directly inside AWS Cloud, outside the VPC, receives the AWS Fargate connection and is the sole API Gateway source connected to Search function. The Search function connection is described twice; draw it once. Keep both display labels ServiceGremlin API. The top-level layout ordering is a visual arrangement instruction, not a list of additional dependency connections.

Oracle đã phân xử: **26 node, 10 explicit containers tính cả AWS Cloud, 24 directed connections**. Hai API Gateway cùng label có role/membership riêng; ba Lambda, ba S3 buckets, ECS và Fargate là các instance riêng. Lấy full role/edge/membership inventory từ prompt đã làm rõ và review từng dòng; `servicegremlin.golden.ts` chỉ là nguồn đối chiếu, không tự coi mọi quyết định của fixture đó là đúng. Cụ thể, edge API Gateway → Search trong golden cũ đi từ instance trong Client API; oracle P15 phải dùng instance trực tiếp trong Cloud theo input đã làm rõ. UI ServiceGremlin rút gọn là prompt khác, không dùng chung oracle. Bỏ qua chỉ dẫn style/left-to-right khi chấm semantics; không cho chúng thành geometry hoặc extra edges.

**P16 — Chỉ boundaries, VI, critical, kiểm tra riêng.**

> Chỉ vẽ kiến trúc network sau: AWS Cloud chứa Region ap-southeast-1; Region chứa VPC Main; VPC Main chứa Public Subnet và Private Subnet. Hai subnet đều rỗng. Không có service node, actor hoặc connection nào. Không thêm AZ, NAT, Internet Gateway hay component khác.

Scope: `network`; nodes: 0; edges: 0; containers: 5. Giữ đầy đủ parent links và type. Không đánh lỗi chỉ vì graph không có nodes; không gọi denominator bằng 0 là “100% AI coverage”.

### 5.4. Freeze và bảo toàn oracle

- Expected được lưu riêng với prompt: role keys, accepted aliases/kinds/assets, field rules, directed edge instances, forbidden predicates và critical flag.
- Mỗi named role phải có điều kiện phân biệt đủ cụ thể. Không cho alias chung `Backend` khớp cả `Backend A` và `Backend B`.
- Prompt P02/P03/P14/P15 phải materialize thành file input hoàn chỉnh, không phụ thuộc substring lookup hoặc đọc output lần trước.
- Nếu prompt/oracle còn mâu thuẫn hoặc không thể biểu diễn bằng IR một membership hiện tại, sửa/làm rõ corpus trước freeze; ghi lý do. Không đoán ý rồi tính parser sai.
- Khi thay oracle hoặc alias sau khi xem output live, tăng suite version và chấm lại cả baseline/candidate trên cùng oracle; giữ artifact cũ. Không đổi đáp án riêng cho candidate.
- P13–P16 được freeze trước tuning. Nếu dùng chi tiết lỗi của chúng để chỉnh prompt, ghi rõ đã dùng làm development; cần case mới để tiếp tục tuyên bố kiểm tra trên dữ liệu chưa dùng khi tuning.

## 6. Matcher xác định

### 6.1. Field rules

Expectation phải phân biệt ba trạng thái, không dùng `undefined` cho cả “bỏ qua” lẫn “phải vắng mặt”:

```ts
type FieldRule<T> =
  | { mode: 'any' }
  | { mode: 'absent' }
  | { mode: 'value'; value: T };

type TextRule =
  | { mode: 'any' }
  | { mode: 'absent' }
  | { mode: 'text'; anyOf: string[]; caseSensitive?: boolean }
  | { mode: 'token'; value: string };
```

`containerId`, `parentId`, scope, labels và relationship đều có rule rõ trong fixture. `ABSENT` yêu cầu field vắng mặt, không đồng nghĩa chuỗi rỗng hoặc một value khác. Kind equivalents được khai báo từng role: có thể cho `aws-service`/`aws-resource` cùng được chấp nhận khi prompt không phân biệt; không cho external/generic lẫn AWS chỉ vì dùng cùng icon.

Text prose được NFC + trim + collapse whitespace, mặc định case-sensitive; chỉ case-fold khi `caseSensitive: false`. Custom labels vẫn phải giữ phân biệt vai trò. Rule `token` so toàn chuỗi chính xác, không case-fold hoặc bỏ punctuation: path như `/api/*`, `/api/wake`, `/ws/*` giữ nguyên hoa thường, dấu `/`, `*` và ký tự. Không dùng fuzzy/substring để `/api/*` khớp `/api/wake`. Các biến thể protocol/label phải nằm trong allowlist đã freeze; không dùng regex rộng hoặc LLM judge.

### 6.2. Entity matching

1. Nhận diện named container role bằng tên/aliases đã freeze; nếu tên xác định duy nhất thì map trước rồi chấm type/parent riêng. Container giữ tên nhưng sai type phải có diff `WRONG_CONTAINER_TYPE`, không bị loại khỏi mapping chỉ vì sai property.
2. Với node, tên vai trò duy nhất xác định identity độc lập asset/kind; map rồi báo `WRONG_ASSET`/`WRONG_KIND` nếu sai. Với tên service thông thường có aliases, dùng các identity discriminators đã freeze từ tên/canonical asset để xác định role; không thêm discriminator dựa trên output đang chấm. Asset/kind không được là hard filter làm rơi một named role đã nhận diện rõ. Identity không nhận diện được mới thành missing/extra hoặc unresolved.
3. Tạo candidate graph và tìm assignment một-một; không greedy lấy node đầu cùng service. Không dùng thứ tự output hoặc ID do provider sinh làm semantics.
4. Với label trùng như P10/P15, dùng `identityPath` đã khai báo từ nhóm có tên để phân biệt. Membership/parent trên toàn output vẫn phải được chấm, không được sửa để match. Nếu output bỏ/đổi placement khiến không phân biệt được role, ghi `SEMANTIC_FAIL` với `UNRESOLVED_IDENTITY`, candidates và các missing/extra/placement facts đã biết. Đây là lỗi output; không được quy thành harness lỗi hoặc chọn assignment làm điểm cao nhất rồi gọi đúng.
5. Chỉ cho phép hoán vị giữa roles mà fixture khai báo thực sự interchangeable. Chốt policy tie-break và giới hạn tìm kiếm, mặc định tối đa 10.000 candidate assignments/case. Chỉ oracle vốn không xác định hoặc matcher vượt giới hạn mới là `HARNESS_ERROR/ORACLE_AMBIGUOUS`; phân biệt chúng với ambiguity do output ở mục 4.
6. Mỗi actual node/container dùng tối đa một lần. Expected không match là missing; actual không match là extra. Không bỏ unmatched objects khỏi report.

ID lexical chỉ dùng để trình bày kết quả ổn định khi các lựa chọn tương đương về nghĩa. Đổi mọi provider ID và đảo thứ tự arrays phải cho cùng verdict/metrics; report có thể đổi actual-ID references.

### 6.3. Edges, placement và forbidden additions

- Sau entity mapping, chấm edge như **multiset có hướng** theo role source/target, label rule và relationship rule. Mỗi actual edge chỉ tiêu thụ một lần.
- Parallel, reciprocal và self-loop là các edge instances riêng. Không dùng `Set(source,target)` hoặc loại duplicate endpoint pair.
- Missing node không được làm các expected incident edges biến mất khỏi mẫu thống kê: chúng vẫn là missing/unresolvable edges. Actual edges đi qua extra nodes vẫn là extra edges.
- Ghi topology diff riêng với label/relationship diff. Đúng endpoints nhưng mất `/api/*` là topology match và labeled-edge failure; không đếm nó thành edge đúng hoàn toàn.
- Membership kiểm tra immediate `containerId`, parent links và ancestor path; không chỉ hỏi node có nằm đâu đó trong VPC hay không.
- Cấm suy diễn placement cũng là assertion: `ABSENT` khác node không match, và khác trực tiếp trong Cloud. Downstream enclosure không sửa verdict parser.
- Forbidden checks chạy trên **toàn output gốc** theo assets, labels/roles và cardinality, kể cả objects không match hoặc bị gắn `generic.component`. Không xem NAT thứ hai là hợp lệ vì NAT thứ nhất đã match.
- Không yêu cầu provider giữ ID của connection hoặc container. Không bỏ hướng, token path, duplicate instances hoặc semantic group để làm graph “tương đương”.

## 7. Metrics và verdict

Mỗi case/trial có outcome stage và strict verdict riêng:

| Stage/status | Ý nghĩa |
| --- | --- |
| `NOT_RUN` | Chưa thử; offline mode, thiếu credential hoặc request budget đã hết |
| `PROVIDER_ERROR` / `TIMEOUT` | Không có output đủ để đo semantics; ghi code/status/duration an toàn |
| `INVALID_JSON` / `EMPTY_OUTPUT` / `INVALID_MODEL` | Provider đã trả output nhưng không qua parse/validation; là failure của parser path |
| `SEMANTIC_FAIL` | IR hợp lệ nhưng có required assertion fail, missing/extra hoặc forbidden violation |
| `PASS` | IR hợp lệ và tất cả assertion bắt buộc của case pass |
| `HARNESS_ERROR` | Fixture/matcher/artifact lỗi; không gán lỗi cho provider và không cho run pass |

Mẫu số live là toàn bộ schedule đã chốt, kể cả timeout/error; không chỉ lấy các response đẹp. `NOT_RUN` khiến coverage không đầy đủ. Lỗi không có model có semantic metrics `null`, đồng thời strict-pass contribution bằng 0; không lấp bằng score giả.

Report tối thiểu:

- Coverage theo case/trial, valid-output rate, strict case-pass rate và pass count của từng case qua ba trial.
- Node/container identity precision và recall: TP/matched, FP/extra, FN/missing; asset/kind/custom-label accuracy riêng trên matched roles.
- Directed-topology precision/recall và labeled-edge precision/recall riêng; wrong/reversed endpoint, lost parallel/self-loop, changed label/relationship có diff cụ thể.
- Required membership/parent accuracy; missing placement, wrong placement, invented placement và forbidden additions theo số lượng cùng entity IDs.
- Micro và macro theo case; `N/A` khi không có assertion thuộc loại đó. Case empty graph phải qua strict zero-extra assertions riêng.
- Duration từng request, p50/p95 của response nhận được, timeout/error counts; tokens/cost chỉ ghi khi có usage và bảng giá có nguồn/version. Không suy chi phí từ số ký tự.

Không gom thành một weighted score che lỗi membership hoặc hallucination. `scope.title`, summaries và generated timestamps không chấm giống chuỗi nếu không được prompt ràng buộc; scope type chỉ chấm khi oracle quy định.

Với mỗi inventory, precision = `TP / (TP + FP)` và recall = `TP / (TP + FN)`; denominator 0 trả `null/N/A`. P16 không có expected nodes nhưng output thêm một node phải có precision 0, recall N/A và strict fail. Cả expected/actual cùng rỗng cho rates N/A, strict zero-extra pass. Macro chỉ bỏ các rate null và công bố số case/trial áp dụng. Các semantic/property rates tính trên valid IR hoặc matched roles phải ghi rõ điều kiện và mẫu số; strict-pass/valid-output rates toàn schedule vẫn giữ mọi error/invalid outcome.

## 8. Chế độ chạy và request budget

### Offline tests và replay

- Test mặc định chỉ chạy fixture/mutation/fake transport, không import credential loader và không gọi network.
- Replay chấm lại artifact đã capture, giữ provenance `replay`, original run ID/provider metadata và hashes. Replay output giống expected chỉ chứng minh matcher hoạt động; không được ghi thành một live lần mới.
- Fixture/parser mock không được xuất hiện dưới tên DeepSeek/Gemini trong report. Thay prompt bất kỳ không được âm thầm nhận canned default fixture.

### Live baseline

- Runner yêu cầu `--mode live`, provider explicit, run directory mới và request budget. Mặc định an toàn là offline, không tự live theo sự tồn tại của env key.
- `--gate harness|baseline|quality` chọn exit gate. Offline/replay mặc định `harness` và không được claim live quality acceptance. Live mặc định `baseline`: ghi baseline đầy đủ thì exit 0 dù quality target fail; `--gate quality` yêu cầu cả baseline coverage và quality target. Flag không tương thích mode phải trả usage error.
- Baseline chính: **16 case × 3 trial = 48 scheduled requests**, concurrency 1, mỗi trial một lần gọi, không automatic retry/repair. Mỗi vòng trial chạy đủ 16 case theo thứ tự đã ghi trước khi sang vòng sau.
- Dùng DeepSeek adapter/config sản phẩm hiện tại; ghi requested model và returned model/fingerprint nếu response có. Trường không quan sát được ghi `unknown`, không suy từ tên adapter.
- Credential lấy từ process environment hoặc secret injection hiện có. CLI không tự đọc/in `.env.local`, không nhận key trong command line và không lưu headers/key/full exception object vào artifacts.
- Deadline mặc định 90 giây/request, `--max-requests 48`. Abort transport thật qua test seam/optional `AbortSignal` hoặc isolate process rồi terminate khi hết deadline; `Promise.race` để request tiếp tục chạy không đủ.
- Tính lần gửi thực tế vào budget ngay trước network call. Hết budget thì còn lại `NOT_RUN`; lỗi budget/timeout không được sinh request ngoài manifest. CTRL+C dừng gửi mới, abort request hiện tại và flush ledger.
- Adapter/SDK retry nội bộ cũng là network sends: tắt automatic retries hoặc observe/count/giới hạn được chúng trước khi cho phép live run. Không chứng minh được budget của adapter tùy chọn thì đánh dấu nhánh đó chưa được hỗ trợ; không suy 48 lần `parse()` là đúng 48 lần gửi.
- HTTP 401/403/429 hoặc lỗi cấu hình lặp lại: dừng gửi tiếp, giữ kết quả đã có và ghi lý do các trial còn lại chưa chạy. Không tự đổi model/key/provider hoặc chuyển mock.
- Muốn thử lại cần run/attempt mới explicit; liên kết lần lỗi cũ, không ghi đè nó hay chọn lần tốt nhất. Live Gemini hoặc API/UI smoke dùng budget/run riêng, không trộn mẫu số DeepSeek.

Đây là giới hạn cho CLI đánh giá. Không biến phần này thành thay đổi UX cancel/retry hoặc chính sách vận hành public của app.

## 9. Mutation và adapter tests bắt buộc

Các test phải assert diffs/coordinates-independent graph facts cụ thể và exit nonzero khi fail. Bản oracle tự match chính nó chưa đủ để chứng minh evaluator bắt lỗi.

| ID | Input/biến đổi có chủ đích | Kết quả bắt buộc |
| --- | --- | --- |
| A01 | Expected graph hợp lệ, đổi toàn bộ IDs và array order | Verdict/metrics tương đương |
| A02 | Alias asset/service label thuộc allowlist; ngoài allowlist | Case đúng pass; alias quá rộng không được nhận |
| A03 | Xóa node; thêm node cùng asset; gộp Backend A/B | Missing/extra/merged-instance failure; incident edges vẫn được tính |
| A04 | Giữ label nhưng đổi asset/kind; unknown asset và generic chủ đích | Wrong asset/kind có diff; fallback không thay correctness; generic đúng không bị phạt |
| A05 | Đổi hướng edge, đổi endpoint nhưng giữ counts | Directed topology failure, không pass vì counts bằng nhau |
| A06 | Xóa/gộp/nhân đôi parallel edge; xóa self-loop | Multiset/cardinality failure đúng role |
| A07 | `/api/*` → `/api/wake`, mất `*`, đổi hoa thường path | Label failure dù endpoints còn đúng |
| A08 | Thêm ALB vào VPC; ECS mất subnet; subtree sai parent | Invented/missing/wrong placement và ancestor diff |
| A09 | Cùng label Work Queue/Worker ở hai nhóm; đảo output order | Map một-một ổn định; di chuyển một instance sang nhóm kia phải fail |
| A10 | Cùng tên API Gateway ở hai role P15 | Không gộp instance hoặc để một node tiêu thụ hai role |
| A11 | Thêm forbidden service, boundary hoặc NAT thứ hai, kể cả generic disguise | Forbidden/extra assertions chạy ngoài matched graph |
| A12 | `ANY` / `ABSENT` / `VALUE`, expected zero nodes/edges, rồi thêm một actual node | Ba trạng thái khác nhau; P16 extra-node fail với precision 0, recall N/A; empty/empty rates N/A |
| A13 | IR JSON thêm geometry/field lạ, broken refs/cycle/duplicate IDs | Validator rejection được ghi; không normalize hoặc layout để cứu |
| A14 | Fake transport: valid, empty, invalid JSON/model, HTTP error | Đúng outcome/exit code, không fallback mock hoặc đổi provider |
| A15 | Fake request chậm, deadline/interrupt/budget hết | Request bị abort/terminated; ledger đủ, không có background retry |
| A16 | Thiếu key hoặc offline/replay mode | Không đọc `.env.local`, không live ngầm; report đúng mode/status |
| A17 | Ambiguous oracle/assignment vượt cap; so với output-induced ambiguity ở A09 | Oracle/cap là HARNESS_ERROR; output làm mất identity là SEMANTIC_FAIL; không tự chọn mapping làm pass |
| A18 | Source/oracle/system-prompt hashes và compare hai suite khác nhau | Không so regression như cùng cohort; ghi incompatibility |
| A19 | Mutation một label/membership sau capture | Replay phát hiện diff, không ghi đè artifact gốc |
| A20 | Provider exception/response chứa dữ liệu ngoài safe projection | Không log key/headers/exception object; dữ liệu response không được execute |

## 10. Baseline, quality target và regression

### Kết quả của bước đo

- `HARNESS_ACCEPTED`: corpus/oracle được review, A01–A20 và typecheck pass, dry-run/replay ledger đúng. Không suy ra AI đã được đánh giá live.
- `LIVE_BASELINE_RECORDED`: đủ 48 outcome theo manifest và có output/parser rejection để đo từng scheduled case/trial; invalid JSON/model vẫn là kết quả failure được ghi nhận. Nếu transport-only/NOT_RUN khiến chưa có bằng chứng cho trial, ghi live baseline incomplete.
- `PARSER_QUALITY_PASS`: mức chất lượng mục tiêu bên dưới đạt trên live run có coverage đầy đủ. Baseline có thể được ghi nhận với quality fail và backlog cụ thể.

Nếu thiếu credential/network thì vẫn hoàn thành được harness, nhưng phần live baseline ghi `BLOCKED/NOT_RUN` với lý do. Không gọi phần đo AI hoàn tất chỉ vì offline fixture pass. Build/browser blocker của Step 1–4 không tự chặn Node parser runner; ghi riêng nếu API/browser smoke chưa chạy.

### Mục tiêu chất lượng ban đầu

Đây là target để thấy khoảng cách và đánh giá candidate, không phải cách đổi đáp án để baseline xanh:

- 48/48 output hợp lệ theo schema/reference và có coverage đầy đủ.
- Ít nhất **44/48 strict passes**; mỗi case ít nhất 2/3; các case đánh dấu critical phải 3/3.
- Không có forbidden-addition hoặc vi phạm explicit negative-placement trên bất kỳ output nào.
- Publish tất cả metric theo §7, cả khi target fail. Ba trial chỉ đo độ lặp lại đã quan sát; không đủ để cam kết reliability ngoài corpus.

### So sánh candidate

Chỉ diff trực tiếp khi suite/oracle/matcher versions và provider/model/request config tương thích. System prompt hash có thể khác vì đó là biến cần thử; phải ghi rõ baseline/candidate. Model/provider khác là cohort khác, không nhập kết quả vào một score.

Report thay đổi pass count từng case, required assertion diffs, invalid-output/transport rate và latency. Bất kỳ critical case giảm pass, case khác giảm số trial pass, hoặc xuất hiện forbidden/placement violation mới đều là regression phải hiển thị; aggregate tăng không che được nó. Không tự promote candidate chỉ từ score trung bình.

Step 5 không bắt buộc chỉnh system prompt. Nếu có slice cải thiện được giao sau khi đo, sửa theo failure class có bằng chứng, chạy lại comparator tests và cả corpus cùng cấu hình. Không thêm keyword routing từ prompt đến canned fixture để “sửa” điểm.

## 11. Integration và browser evidence

1. Offline API/adapter integration bằng fake transport: request hợp lệ đi qua cùng adapter/validator, output/issue metadata giữ đúng; lỗi không bị báo success. Không tạo production endpoint chứa oracle hoặc credentials eval.
2. Optional downstream check với parser IR đã capture: chạy pipeline và kiểm tra semantic preservation qua prepare/layout/Document theo contracts Step 2–4. Ghi các biến đổi Cloud hợp lệ riêng; không dùng downstream model thay điểm parser.
3. Khi Next chạy được, smoke P02 và P05 qua `/api/parse-architecture`/UI Generate với budget riêng hai request. Đối chiếu IR, metadata provider và Document; xác nhận không dùng Quick Test. Chỉ ghi rendered/editor behavior nếu đã quan sát browser thật.
4. Khi SWC vẫn bị chặn, ghi API/browser smoke `BLOCKED`; không lặp lại build liên tục hoặc thay dependency chỉ để lách bằng chứng. Các mục browser Step 1–4 tiếp tục mở.

Không lấy diagnostics counts, hand-authored golden hoặc replay thành bằng chứng provider hiểu prompt/canvas render đúng.

## 12. Module và thứ tự thực hiện

```text
src/core/ai/evaluation/
  types.ts                         # Oracle/rules, result/diff contracts
  matchEntities.ts                 # Injective role matching, ambiguity/cap
  compareSemantics.ts              # Edges, fields, placement, forbidden checks
  metrics.ts                       # Counts/rates, explicit N/A
src/core/ai/providers/*             # Minimal fake-transport/observer/abort seams
tests/fixtures/parser-eval/
  manifest.ts                      # P01–P16, context, priorities, hashes/version
  prompts/P01.txt ... P16.txt       # Full frozen provider inputs
  expected/P01.json ... P16.json    # Reviewed oracle, no geometry/provider IDs
  mutations.ts                     # A01–A20 inputs with expected diffs
scripts/test-parser-evaluation.ts   # Offline, never live by default
scripts/evaluate-parser.ts          # Offline/replay/live runner + budget/artifacts
scripts/compare-parser-runs.ts      # Cohort checks and regression report
docs/evaluations/<run-id>/          # Captured evidence, not a source of oracle
```

Có thể gom helper nhỏ; không thêm service/database/framework riêng. Eval modules không được import React, Next, DOM, localStorage hoặc layout. Provider-only observation không rò vào client bundle. Không đổi IR/Document schema để nhét điểm, oracle hoặc provider payload.

Thứ tự:

1. Đọc current source/baseline, chốt parser-vs-downstream stage và corpus semantics; phân xử P15.
2. Tạo đầy đủ prompt/oracle P01–P16, review role/cardinality/negative placement; freeze hashes/version.
3. Viết matcher/diffs/metrics rồi mutation tests A01–A13, A17–A19; chứng minh same-count wrong graph vẫn fail.
4. Thêm adapter test seams, runner/replay/deadline/budget; fake transport A14–A16/A20. Kiểm tra offline không tạo network call.
5. Typecheck/regression trên source cuối; dry-run manifest 48 slots, kiểm tra artifact/exit codes.
6. Chạy DeepSeek live explicit khi có credential/network; giữ toàn bộ outcome, ghi baseline/backlog. Chưa có điều kiện thì báo phần này chưa chạy.
7. Diff baseline/candidate nếu được giao thay đổi parser; smoke API/browser khi môi trường sẵn sàng; lưu report đúng mức bằng chứng.

CLI dự kiến sau khi triển khai, từ `D:\Project\Kora`:

```powershell
.\node_modules\.bin\tsx.cmd scripts/test-parser-evaluation.ts
.\node_modules\.bin\tsx.cmd scripts/evaluate-parser.ts --mode offline --out docs/evaluations/<new-run-id>
.\node_modules\.bin\tsx.cmd scripts/evaluate-parser.ts --mode replay --input docs/evaluations/<captured-run> --out docs/evaluations/<new-replay-id>
.\node_modules\.bin\tsx.cmd scripts/evaluate-parser.ts --mode live --gate baseline --provider deepseek --repetitions 3 --max-requests 48 --timeout-ms 90000 --out docs/evaluations/<new-live-id>
.\node_modules\.bin\tsx.cmd scripts/evaluate-parser.ts --mode live --gate quality --provider deepseek --repetitions 3 --max-requests 48 --timeout-ms 90000 --out docs/evaluations/<new-quality-id>
.\node_modules\.bin\tsx.cmd scripts/compare-parser-runs.ts --baseline docs/evaluations/<baseline-id> --candidate docs/evaluations/<candidate-id>
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
```

Các lệnh eval là **entrypoint cần tạo**, chưa phải file/lệnh đang tồn tại. Hai ví dụ live là hai lựa chọn gate, không phải hai lượt bắt buộc chạy nối tiếp; mỗi lượt có request budget riêng và phải được chọn explicit. Thêm package aliases cho offline test và runner; alias test mặc định không gọi live. Nếu `tsx` bị policy chặn như các run trước, dùng bundled Node + TypeScript emission vào thư mục tạm ngoài source và ghi lệnh/exit code thực tế. Không để generated JS trong `src/` hoặc gọi credential-bearing legacy scripts để thay coverage.

Regression phù hợp: Document validation/ingestion, editor command/transaction, parser offline, baseline, ServiceGremlin golden và layout routing/geometry/worker khi adapter/pipeline có thay đổi liên quan. Typecheck/build chạy trên source cuối theo điều kiện môi trường; pure doc/fixture changes không tự biến browser checks thành pass.

## 13. Artifact và báo cáo

```text
docs/evaluations/<run-id>/
  environment.json                 # Timezone, runtimes, NO_GIT/hash or commit
  manifest.json                    # Mode, provider/config, schedule, budgets
  suite-snapshot/                  # Frozen synthetic inputs + reviewed oracle
  trials/Pxx/t1/ ... t3/
    observation.json               # Safe metadata, errors/duration, provenance
    provider-output.txt            # If observer can capture; otherwise reason
    parser-ir.json                 # Only when adapter returned valid model
    issues.json
    semantic-diff.json             # Maps, missing/extra, field failures
  results.json                     # Every scheduled slot, no deleted failure
  comparison.json                  # Only when comparable runs supplied
  report.md
  issues.md
```

`run-id` dùng thời điểm bắt đầu thực tế theo Asia/Saigon; runner từ chối ghi đè run đã có. Hash prompt/context/oracle/system prompt, matcher/source identity, requested/returned model và các generation options phải đủ để giải thích khác biệt. Không có Git thì ghi `NO_GIT` và SHA-256 source liên quan; provider không công bố revision thì ghi giới hạn tái lập đó.

Report nêu rõ:

- Mode và coverage: offline/replay/live/API/browser; provider nào thực sự được gọi.
- Trạng thái harness, baseline và quality target riêng; không chỉ một dòng “tests passed”.
- Bảng 16 case × 3 trial, stage/verdict, metrics và links đến diff/IR/observation.
- Failure classes với case/role/edge cụ thể, ví dụ mất Backend B, `/ws/*` bị gộp, ALB bị suy diễn vào VPC.
- Issue severity/tần suất, input hash, observed output, expected và hướng xử lý; phân biệt oracle defect, parser fidelity, validator defect, downstream loss và môi trường.
- Những gì chưa quan sát được, raw payload không capture được, context chưa được adapter dùng hoặc artifact thiếu; không tự điền như đã đo.

Exit codes: `0` khi gate được yêu cầu pass; `1` khi assertion/quality gate fail; `2` khi usage/harness/coverage bị chặn hoặc thiếu điều kiện. Runner phải flush report trước khi exit. Ghi quality target fail không ngăn xuất baseline; hoàn tất phần đo được xác định theo evidence trong §10.

Deliverables hiện có: corpus/oracle, evaluator/runners/test seams, offline tests và report dưới `docs/evaluations/`. Run hiện tại chứng minh harness/replay/comparator offline; live baseline chưa chạy và chất lượng parser chưa được đo. Xem [báo cáo thực hiện Step 5–6](../experience/20261018-104520/report.md) để biết coverage và blocker.

## 14. Điều kiện nghiệm thu Step 5

- [ ] P01–P16 có full input/context, oracle đã review, version/hash và critical flags; P15 đã được làm rõ trong chính provider input.
- [ ] Matcher không phụ thuộc provider IDs/order, map một-một và giữ duplicate-label instances, multiset edges, raw placement/absence.
- [ ] Assets/labels/scope/membership/forbidden assertions có diffs; generic có chủ đích và fallback được phân biệt.
- [ ] A01–A20 pass, có mutation negative đủ mạnh; offline/replay không tạo provider call hoặc claim live coverage.
- [ ] Runner dùng adapter sản phẩm, provenance/config thực tế, hard deadline/budget, ledger không mất failures và exit codes đúng.
- [ ] Có live baseline 48 outcome đủ bằng chứng theo §10; chất lượng có thể fail nhưng mọi lỗi phải được ghi rõ. Thiếu điều kiện thì mục này còn mở.
- [ ] Có metrics từng case/trial và backlog; quality target được báo PASS/FAIL/INCOMPLETE riêng với harness acceptance.
- [ ] Comparison từ chối cohorts khác nhau và hiển thị regression từng case, không dùng aggregate để che lỗi critical.
- [ ] Typecheck/regression phù hợp có bằng chứng trên source cuối; API/browser smoke và các blocker cũ được ghi đúng mức.
- [ ] Report đủ để một lần sửa parser sau này biết đã cải thiện điểm nào và có làm hỏng case khác hay không.

**Kết quả mong đợi:** biết AI parser đang giữ đúng hay làm mất ý nào của prompt, có cách đo lặp lại, và có regression gate trước khi thay prompt/model. Chất lượng render/editor vẫn dùng acceptance riêng của Step 1–4.
