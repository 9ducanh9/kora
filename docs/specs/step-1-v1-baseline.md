# Kora — Step 1: Chốt baseline V1

Ngày soạn: 2026-10-17  
Trạng thái: Baseline ban đầu đã chạy; browser/build bị chặn. Regression sau implementation: B1, B2, B3, B3-empty đều pass offline. Xem [báo cáo baseline ban đầu](../baseline/20261017-1917/report.md) và [kết quả regression mới nhất](../baseline/20261017-2104-final/results.json).  
Thư mục dự án: `D:\Project\Kora`  
Tài liệu gốc: [Kora V1](../../kora_initial_spec.md), đặc biệt mục 17–19 và 22.

## 1. Mục tiêu

Đo trạng thái hiện tại của Kora bằng build, test offline và kiểm tra browser trên ba architecture xác định. Kết quả phải trả lời được:

1. Dự án có build được với dependency hiện tại không?
2. IR hợp lệ có đi qua validation, asset resolution, normalization và layout mà không mất thực thể không?
3. Document đó có được render thành diagram đọc được và chỉnh sửa được không?
4. Những thao tác nào đã hoạt động, thao tác nào lỗi và cách tái hiện từng lỗi là gì?

Step 1 hoàn thành khi có báo cáo đủ bằng chứng và backlog có thứ tự ưu tiên. Không yêu cầu tất cả tính năng V1 phải pass mới được chốt baseline. Một lỗi sản phẩm được tái hiện và ghi nhận đầy đủ vẫn là kết quả hợp lệ của bước này.

Không gọi pipeline offline là bằng chứng AI hiểu prompt. Không gọi build thành công hoặc đủ số object trong Document là bằng chứng browser render thành công.

## 2. Phạm vi

### Trong phạm vi

- Ghi nhận môi trường, phiên bản dependency thực tế và danh tính source được kiểm tra.
- Chạy build, typecheck, lint và các test offline hiện có; ghi exit code cùng log.
- Bổ sung fixture và test harness tối thiểu để kiểm tra ba case ở mục 4.
- Xuất `DiagramDocument` từ pipeline thật để import vào ứng dụng khi kiểm tra browser.
- Kiểm tra render, chỉnh sửa, undo/redo, Auto Layout và save/load.
- Ghi lỗi tái hiện được, thiếu coverage và đề xuất slice sửa đầu tiên.
- Có thể chạy smoke test provider thật riêng nếu có credential dùng được; ghi rõ kết quả hoặc lý do không chạy.

### Ngoài phạm vi

- Sửa logic sản phẩm, đổi schema hoặc refactor kiến trúc trong cùng bước đo baseline.
- Đổi provider, tối ưu system prompt, nâng dependency hoặc thay layout engine.
- Thêm auth, database, collaboration, export hình hoặc deploy.
- Mở rộng thành bộ đánh giá AI 10–20 prompt; đó là bước phát triển sau.

Được thêm file test, fixture, script đo và tài liệu báo cáo. Chỉ thêm npm script nếu thực sự cần; giữ nguyên version dependency và lockfile. Nếu phải thay source sản phẩm mới tiếp tục được, ghi blocker và phạm vi bị ảnh hưởng thay vì sửa trong lúc đo.

## 3. Hiện trạng đã đọc từ source

Các nhận xét sau là dữ kiện để thiết kế phép kiểm tra, chưa phải kết quả chạy:

| Thành phần | Hiện trạng | Hệ quả với baseline |
| --- | --- | --- |
| `package.json` | Có `build`, `lint`, `test:parser`, `test:golden`, `test:deepseek`; chưa có script typecheck | Dùng binary local cho typecheck và các test chưa có npm script |
| `scripts/test-parser.ts` | Có thể gọi Gemini thật khi `GEMINI_API_KEY` tồn tại | Phải cô lập biến này khi chạy offline |
| `tests/fixtures/mock.parser.ts` | Match một substring đã biết; prompt khác có thể nhận fixture mặc định 4 nodes | Không dùng Quick Test để chứng minh ba prompt khác nhau đều được hiểu |
| `src/components/prompt/PromptHeader.tsx` | Có Quick Test và DeepSeek; mặc định DeepSeek | Chủ động chọn Quick Test khi đo offline |
| `src/core/pipeline/generationPipeline.ts` | Có diagnostics, gồm `renderedCounts` tính từ Document | Kiểm tra browser độc lập; không dùng tên field để suy ra đã render |
| `scripts/test-servicegremlin-golden.ts` | Kiểm tra fixture, assets, hierarchy và một số tọa độ | Chưa chứng minh parser thật, không overlap hoặc thao tác editor |
| `src/core/diagram/storage.ts` | Import kiểm tra cấu trúc sơ bộ; localStorage parse rồi ép kiểu | Ghi coverage về độ toàn vẹn save/load; validation đầy đủ thuộc bước sau |
| `src/core/layout/elkCompoundLayout.ts` | Chuyển hierarchy ELK thành tọa độ tuyệt đối | Kiểm tra bounding box toàn phần và empty container |
| `src/components/canvas/KoraCanvas.tsx` | Adapter Document → React Flow, có handlers chỉnh sửa | Phải thao tác thực tế để xác nhận state và canvas đồng bộ |

`scripts/diagnose-pipeline.ts` có các kết luận viết sẵn về default parser và trạng thái downstream. Không dùng phần kết luận đó như bằng chứng hiện tại; đối chiếu source và quan sát thực tế.

Lần kiểm tra thư mục khi soạn spec không tìm thấy Git repository tại `D:\Project\Kora`. Khi thực hiện phải xác minh lại; nếu vẫn không có Git, dùng SHA-256 của source đầu vào thay cho commit SHA. Không khởi tạo Git như một phần của baseline.

## 4. Bộ case bắt buộc

Mỗi case có prompt, IR fixture cố định và expected graph. Fixture chỉ chứa semantics, không có tọa độ. Đưa fixture qua `executeArchitecturePipeline`; không dựng Document bằng tay để bỏ qua pipeline.

IDs bên dưới cố định cho test offline. Nếu chạy provider thật, đối chiếu theo vai trò, asset và quan hệ; không bắt LLM tạo đúng chuỗi ID của fixture.

| Case | Nodes | Connections | Containers trong IR | Containers sau normalization |
| --- | ---: | ---: | ---: | ---: |
| B1 — Đơn giản | 3 | 2 | 0 | 1 AWS Cloud |
| B2 — Phân nhánh, acceptance gốc | 6 | 5 | 2 | 3 |
| B3 — Hai private subnets | 7 | 7 | 3 | 4 |
| B3-empty — Biến thể empty container | 7 | 7 | 4 | 5 |

Tất cả case dùng `version: "1.0"`, `scope.type: "overall-architecture"`. AWS Cloud được hệ thống bổ sung, có `origin: "system"`. Users ở ngoài Cloud. Không tự thêm Region, AZ hay service ngoài expected graph.

### B1 — Đơn giản

```text
Draw this AWS architecture:
Users access CloudFront over HTTPS.
CloudFront serves static content from an S3 bucket using /assets/*.
Do not add a VPC or subnet.
```

- Nodes: `users` (`external.user`), `cloudfront` (`aws.cloudfront`), `s3` (`aws.s3`).
- Edges: `users → cloudfront` label `HTTPS`; `cloudfront → s3` label `/assets/*`.
- Hai AWS nodes nằm trực tiếp trong Cloud; không có container khác.

### B2 — Phân nhánh, acceptance gốc

```text
Draw this AWS architecture:
Users access CloudFront over HTTPS.
CloudFront routes /assets/* to a private S3 bucket.
CloudFront routes /api/* to an Application Load Balancer.
The ALB forwards traffic to ECS Fargate.
ECS runs inside a private subnet in a VPC.
ECS stores application state in DynamoDB.
```

- Nodes: `user`, `cloudfront`, `s3`, `alb`, `ecs`, `dynamodb`.
- Assets tương ứng: `external.user`, `aws.cloudfront`, `aws.s3`, `aws.elb.alb`, `aws.ecs.fargate`, `aws.dynamodb`.
- Edges: `user → cloudfront` (`HTTPS`), `cloudfront → s3` (`/assets/*`), `cloudfront → alb` (`/api/*`), `alb → ecs` (`Forward`), `ecs → dynamodb` (`State`).
- Hierarchy: `cloud-aws → vpc → subnet-private → ecs`.
- CloudFront, S3, ALB và DynamoDB thuộc Cloud; không suy diễn thêm membership VPC/subnet.

Case này tương ứng acceptance mục 22 của spec gốc và fixture có sẵn. Dùng ID `user` để khớp fixture Quick Test hiện tại. IDs connections có thể khác giữa fixture runner và Quick Test; đối chiếu endpoints/labels và lưu mapping thực tế, không báo lỗi chỉ vì tên connection khác. Có thể dùng Quick Test để kiểm tra thao tác Generate offline, với điều kiện xác nhận đúng fixture trả về.

### B3 — Hai private subnets

```text
Draw this AWS architecture:
Users access CloudFront over HTTPS.
CloudFront routes /assets/* to a private S3 bucket and /api/* to an ALB.
The ALB forwards to two separate ECS Fargate services: Backend A and Backend B.
VPC Main contains Private Subnet A and Private Subnet B.
Backend A belongs to Private Subnet A; Backend B belongs to Private Subnet B.
Both backends store application state in the same DynamoDB table.
CloudFront, S3, ALB and DynamoDB are in AWS Cloud, outside VPC Main.
Users are outside AWS Cloud. Do not add Regions or Availability Zones.
```

- Nodes: `users`, `cloudfront`, `s3`, `alb`, `backend-a`, `backend-b`, `dynamodb`.
- Hai backend dùng `aws.ecs.fargate`, có label riêng `Backend A` và `Backend B`; các node còn lại dùng asset như B2.
- Edges: `users → cloudfront` (`HTTPS`), `cloudfront → s3` (`/assets/*`), `cloudfront → alb` (`/api/*`), `alb → backend-a` (`Forward A`), `alb → backend-b` (`Forward B`), `backend-a → dynamodb` (`State A`), `backend-b → dynamodb` (`State B`).
- Containers khai báo: `vpc-main`, `subnet-private-a`, `subnet-private-b`.
- Hai subnet có `parentId: "vpc-main"`; mỗi backend có đúng `containerId` tương ứng.
- AWS nodes còn lại thuộc Cloud, nằm ngoài bounding box của VPC.

**B3-empty:** giữ nguyên graph B3, thêm `subnet-private-empty` dưới `vpc-main`, label `Reserved Private Subnet`, không có child. Mục đích là kiểm tra container rỗng vẫn nằm trong `presentation.containers` và hiển thị đúng loại object. Không thêm node giả để lấp container.

Prompt B3-empty là nguyên văn prompt B3, thêm câu: `VPC Main also contains an empty private subnet named Reserved Private Subnet. Do not put any component inside it.`

## 5. Quy trình thực hiện

### 5.1. Ghi nhận môi trường và bảo toàn dữ liệu

1. Xác nhận cwd, hướng dẫn repository nếu có, source đang dùng và các thay đổi có sẵn.
2. Ghi OS, Node, npm, browser, Next/React/React Flow/ELK thực tế đã cài; không suy ra version cài đặt chỉ từ range trong `package.json`.
3. Ghi Git HEAD và working tree nếu có Git. Nếu không, ghi `NO_GIT` và tạo danh sách SHA-256 cho `package.json`, lockfile, config, toàn bộ source/test/script đầu vào.
4. Dùng browser profile hoặc origin local riêng cho baseline. Không xóa localStorage đang chứa diagram của người dùng; nếu phải dùng phiên hiện tại, export bản lưu trước và khôi phục sau.
5. Không in API key, nội dung `.env.local` hoặc headers chứa credential vào log. Báo cáo chỉ ghi provider/model và trạng thái có hoặc không có credential.

Các lệnh tham chiếu chạy từ root dự án, bằng PowerShell:

```powershell
Set-Location 'D:\Project\Kora'
node --version
npm.cmd --version
node -p "require('./node_modules/next/package.json').version"
```

Dependency chưa sẵn sàng thì ghi blocker hoặc cài đúng lockfile nếu môi trường cho phép. Không dùng cập nhật dependency để làm cho baseline xanh.

### 5.2. Chạy các kiểm tra hiện có

Chạy từng lệnh, lưu stdout/stderr, exit code, thời điểm bắt đầu/kết thúc. Một lệnh fail không được làm mất kết quả các lệnh độc lập khác.

| ID | Lệnh | Bằng chứng cần lưu |
| --- | --- | --- |
| C1 | `npm.cmd run build` | Build thành công hoặc lỗi cụ thể |
| C2 | `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` | Kết quả typecheck độc lập |
| C3 | `npm.cmd run lint` | Kết quả thực tế, gồm thiếu config/dependency nếu gặp |
| C4 | `npm.cmd run test:parser` với Gemini key bị cô lập | Validation, mock và layout trong script hiện có |
| C5 | `npm.cmd run test:golden` | Regression từ ServiceGremlin fixture |
| C6 | `.\node_modules\.bin\tsx.cmd scripts/test-containers.ts` | Kiểm tra hierarchy/container hiện có |
| C7 | `.\node_modules\.bin\tsx.cmd scripts/test-compact-nodes.ts` | Asset display và node dimensions hiện có |

`test:parser` không mặc nhiên offline. Có thể cô lập credential trong process đang chạy test như sau; khôi phục nguyên trạng sau đó:

```powershell
$baselineHadGeminiKey = Test-Path Env:GEMINI_API_KEY
$baselineGeminiKey = $env:GEMINI_API_KEY
try {
    $env:GEMINI_API_KEY = ''
    npm.cmd run test:parser
    $baselineParserExitCode = $LASTEXITCODE
} finally {
    if ($baselineHadGeminiKey) {
        $env:GEMINI_API_KEY = $baselineGeminiKey
    } else {
        Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
    }
}
```

Nếu lint mở wizard tương tác, dừng lệnh và ghi thiếu cấu hình; không tự cài ESLint hoặc sửa config trong bước đo. Đọc assertions và log thay vì chỉ nhìn exit code: script hiện có có nhánh ghi `[FAIL]` mà không kết thúc bằng lỗi.

### 5.3. Bổ sung phép kiểm tra pipeline cho bộ baseline

Tạo runner nhỏ bằng TypeScript/tsx, dùng module production hiện có. Không cần thêm test framework. Với B1, B2, B3 và B3-empty:

1. Clone fixture trước mỗi lần chạy để tránh ảnh hưởng do mutation.
2. Chạy `executeArchitecturePipeline` với metadata `baseline-fixture`; không gắn metadata Gemini/DeepSeek khi không gọi provider.
3. Đối chiếu **tập ID và giá trị**, không chỉ counts: nodes, asset IDs, edges có source/target/label, container type, parent và membership.
4. Kiểm tra đúng một Cloud root; không mất hoặc phát sinh thực thể ngoài Cloud được chuẩn hóa.
5. Kiểm tra tập key semantic/presentation tương ứng. Container rỗng phải có presentation của container; không được xuất hiện như service node.
6. Kiểm tra tọa độ hữu hạn, dimensions dương; dùng dimensions trong Document hoặc resolver hiện có khi node chưa lưu kích thước.
7. Kiểm tra bounding box **toàn bộ** child nằm trong parent, có tính vùng header/padding theo registry. Chỉ kiểm tra góc trái trên là chưa đủ.
8. Kiểm tra leaf nodes và sibling containers không chồng diện tích; parent chứa child là overlap có chủ đích và phải được loại khỏi phép so sánh này. Dùng sai số hình học tối đa 1 canvas unit.
9. Kiểm tra file asset cho tất cả nodes và container badges trong bộ case tồn tại dưới `public`; AWS asset không được fallback sang `generic.component`.
10. Chạy mỗi case hai lần với input và options giống nhau. So sánh semantic và geometry sau khi loại timestamp; geometry sai lệch quá 1 unit là fail. Không so sánh timestamp để kết luận layout thiếu deterministic.
11. Xuất Document, kết quả assertion và diagnostics thực tế. Geometry/document thành công không thay thế phép kiểm tra browser về text clipping và đường nối.

Runner phải chạy hết các case độc lập, ghi từng lỗi, cuối cùng trả exit code khác 0 nếu có assertion fail. Nếu pipeline ném lỗi, lưu stage/error; không sửa fixture hoặc kỳ vọng để che lỗi. Chỉ xuất Document khi pipeline thật trả về được Document.

Runner nhận `--out <directory>` bắt buộc; dùng binary local `tsx.cmd` để chạy, không tự tải package. Sau khi thêm hoặc sửa test harness, chạy lại C2 và C1 vì `tsconfig.json` bao gồm toàn bộ TypeScript trong dự án. Lưu riêng log trước/sau khi thêm harness. Lỗi do mã test mới phải sửa trong harness rồi kiểm tra lại; lỗi sản phẩm vẫn ghi backlog. Cập nhật source hashes để bao gồm toàn bộ fixture/runner bản cuối đã chạy.

Để xác minh runner có thể phát hiện sai lệch, cho assertion helper nhận một bản sao kết quả đã bỏ node hoặc thay membership và xác nhận bị từ chối. Không thay dữ liệu sản phẩm.

### 5.4. Kiểm tra trên browser

Ưu tiên kiểm tra bản production local sau build:

```powershell
npm.cmd run start -- --port 3100
```

Nếu build fail, có thể dùng `npm.cmd run dev -- --port 3100` để tiếp tục thu thập bằng chứng. Báo cáo phải ghi `DEV_ONLY`; kết quả đó không làm C1 pass. Nếu port bận, chọn port khác và ghi URL thực tế. Không chạy build và dev cùng lúc trên cùng output `.next`.

Ghi browser/version, viewport và theme. Dùng viewport chuẩn 1440×900, browser zoom 100%; kiểm tra cả light/dark cho render và ít nhất một theme cho toàn bộ chuỗi chỉnh sửa. Không bắt pixel screenshot phải giống tuyệt đối giữa các lần chạy.

- **B2:** chọn Quick Test, nhập đúng prompt B2, Generate; xác nhận fixture và graph tương ứng. Đây là kiểm tra Generate offline.
- **B1, B3, B3-empty:** import JSON do runner xuất qua UI hiện có. Ghi đường vào là `fixture-pipeline → JSON import → canvas`; không mô tả thành `prompt → AI → canvas`.
- Nếu không import/render được, lưu lỗi và đánh dấu các thao tác phụ thuộc là `BLOCKED`; vẫn kiểm tra các case độc lập còn lại.

Mỗi case bắt đầu từ Document gốc. Các thao tác có tác động phải reset/import lại trước phép kiểm tra độc lập tiếp theo.

| ID | Thao tác | Điều kiện pass |
| --- | --- | --- |
| U1 | Mở diagram, Fit View, xem thêm ở canvas zoom 100% | Đủ nodes/edges/containers đúng loại; icon load; tên và label đọc được; không clipping/overlap che nội dung |
| U2 | Select một node; pan, zoom và select nhiều node | Selection có phản hồi; pan/zoom không làm thay đổi semantics hoặc tọa độ đã lưu của objects |
| U3 | Kéo một node rồi Undo/Redo một lần | Vị trí thực thay đổi; edges vẫn gắn; một Undo trở về trước drag và một Redo khôi phục sau drag |
| U4 | Kéo selection gồm hai node | Cả hai dịch chuyển cùng delta; một Undo/Redo khôi phục toàn selection; graph không đổi |
| U5 | Đổi node label và edge label bằng UI | Lưu đúng text; Undo/Redo khôi phục từng thao tác, không sinh lịch sử trùng do Enter/blur |
| U6 | Tạo edge mới; reconnect; xóa edge | Đúng endpoints, không sinh duplicate ngoài ý muốn; Undo/Redo khôi phục kết nối |
| U7 | Xóa một service node có connections | Node và edges liên quan biến mất; không còn dangling references; Undo khôi phục đủ |
| U8 | Chạy Auto Layout | Đọc được, hierarchy và labels còn nguyên; một Undo khôi phục geometry trước layout |
| U9 | Save → reload trang → Load nếu cần | Giữ semantics, tọa độ cuối đã Save và khả năng chỉnh sửa; không yêu cầu history tồn tại qua reload |
| U10 | Export JSON → import lại | Semantics, labels, membership và geometry tương đương; vẫn sửa được node/edge |

U4 cần hai service nodes, không dùng parent/child làm selection để tránh trộn phép kiểm tra group. Với U6 chọn endpoints và label chưa có trong graph, ghi rõ cặp node sử dụng. B1 dùng edge bổ sung `users → s3`.

Riêng B2/B3, kiểm tra thêm container:

- Kéo VPC: toàn bộ subnets và nodes con đi cùng, relative positions không đổi; một Undo/Redo khôi phục cả subtree.
- Kéo một subnet: backend con đi cùng, subnet bên cạnh giữ vị trí; parent references không bị đổi ngầm.
- Đổi label container, Undo/Redo; kết quả phải thuộc đúng container.
- Xóa một subnet chứa backend: kết quả an toàn có thể là từ chối thao tác có thông báo hoặc cascade có thể Undo. Không được còn orphan membership hay dangling edges. Ghi chính sách hiện có; việc chốt UX lâu dài thuộc bước editor.
- B3-empty phải thấy `Reserved Private Subnet` như boundary, có kích thước dương và đúng parent; không thay bằng một service icon.

Lưu screenshot trước/sau cho render và lỗi hình học; dùng clip hoặc snapshot trạng thái để chứng minh drag/history. So sánh JSON trước/sau cho save/load và graph integrity. Tách kết luận về dữ liệu khỏi kết luận về hình ảnh. Ghi console errors và network failures liên quan đến flow; lỗi có sẵn hoặc extension phải được phân biệt.

### 5.5. Smoke test provider thật — báo cáo riêng

Đây là hạng mục tùy điều kiện, không phải điều kiện chặn việc chốt baseline offline. Nếu thực hiện, dùng UI DeepSeek và prompt B2 một lần, ghi provider/model thực tế, thời gian, kết quả graph, warnings và lỗi. Không dùng retry nhiều lần rồi chỉ lưu lần pass.

Nếu không có credential/network phù hợp, ghi `NOT_RUN` cùng lý do. `test:deepseek` hiện đọc `.env.local` và có catch chỉ ghi lỗi; không dùng exit code của script này làm bằng chứng provider pass.

Chỉ một lần gọi thành công cũng chưa chứng minh độ chính xác hoặc độ ổn định của parser trên nhiều prompt. Muốn tuyên bố đã kiểm tra toàn luồng AI cần bằng chứng request thực, model trả về, pipeline và canvas của chính request đó.

## 6. Deliverables

Cấu trúc dưới đây là đầu ra cần tạo khi **thực hiện** Step 1; spec này chưa tạo fixture, runner hay báo cáo kết quả:

```text
tests/fixtures/baseline/
  cases.ts                       # Prompts, semantic fixtures và expected graphs
scripts/
  test-baseline.ts                # Gọi pipeline, assertions, xuất evidence
docs/baseline/<run-id>/
  report.md
  issues.md
  environment.json               # Versions, source identity, URL, browser, theme
  results.json                   # ID, status, observation, evidence, issue link
  source-sha256.json              # Khi không có Git; hoặc dùng Git identity + diff
  logs/
  documents/                     # JSON do pipeline xuất, JSON trước/sau thao tác
  screenshots/
```

`run-id` dùng thời gian bắt đầu thực hiện theo Asia/Saigon, không dùng ngày soạn spec giả làm ngày chạy. Runner nên nhận output directory rõ ràng và từ chối ghi đè run cũ. Không commit build output, credentials hoặc browser profile vào evidence.

`report.md` phải có môi trường, source identity, cách tái chạy, kết quả C1–C7, pipeline từng case, ma trận browser từng case/theme, coverage provider và slice sửa đề xuất. Mỗi hàng `results.json` dùng một trong bốn trạng thái:

- `PASS`: quan sát đúng expected behavior, có bằng chứng.
- `FAIL`: đã thực hiện và quan sát sai expected behavior.
- `BLOCKED`: không thực hiện được vì dependency cụ thể; liên kết blocker.
- `NOT_RUN`: chưa chạy, kèm lý do và giới hạn kết luận.

Không có trạng thái trống hoặc suy luận pass từ test khác. Mỗi assertion/browser check có ID gắn case, ví dụ `B3-U3-dark` hoặc `B3-empty-presentation-keys`.

Mỗi issue có ID, mức ảnh hưởng, case/check bị lỗi, preconditions, các bước tái hiện, expected/actual, tần suất, bằng chứng và module nghi ngờ. Phân biệt **nguyên nhân đã chứng minh** với **giả thuyết từ source**.

Ưu tiên backlog theo ảnh hưởng:

1. Mất/hỏng dữ liệu, không mở được app, mất nodes/edges/containers.
2. Không chỉnh sửa được, history sai, save/load sai hoặc container membership sai.
3. Diagram khó đọc, label/edge/geometry lỗi và vấn đề giao diện còn lại.

Không gán trước trạng thái FAIL cho những rủi ro mới chỉ thấy trong code. Nếu issue chỉ xuất hiện một lần, ghi `1 lần quan sát`; thử lại từ cùng fixture trước khi kết luận lỗi tái hiện ổn định.

## 7. Thứ tự triển khai

1. Ghi nhận môi trường/source và bảo toàn diagram đang có.
2. Chạy C1–C7, lưu log và các hạn chế của test hiện có.
3. Tạo bộ fixtures và runner, xác minh expected graph theo mục 4; chạy kiểm tra pipeline, chạy lại C2/C1 và cập nhật source identity cho bản cuối.
4. Kiểm tra browser bằng đúng Documents vừa xuất, riêng Generate offline dùng B2.
5. Chạy provider smoke nếu đủ điều kiện, ghi riêng coverage.
6. Tái hiện lỗi ưu tiên cao, hoàn thiện report, results và issues.
7. Đề xuất slice tiếp theo dựa trên lỗi quan sát được, không mở rộng scope Step 1 thành sửa toàn bộ V1.

## 8. Điều kiện nghiệm thu Step 1

- [ ] Có source identity và môi trường đủ để chạy lại, bảo toàn dữ liệu có sẵn.
- [ ] C1–C7 đều có trạng thái, exit code nếu đã chạy, log và giải thích hạn chế.
- [ ] B1/B2/B3/B3-empty có fixture và expected graph đầy đủ, dùng pipeline production.
- [ ] Assertions kiểm tra ID, semantics, hierarchy, assets, full bounds, sibling overlap, empty container và tính lặp lại; lỗi làm runner trả nonzero.
- [ ] Fixture/runner bản cuối đã được typecheck/build lại, có source identity và log tương ứng; tách lỗi harness khỏi lỗi sản phẩm.
- [ ] Có bằng chứng browser cho từng case có thể mở được, gồm light/dark render và chuỗi chỉnh sửa đã quy định; phần bị chặn có blocker cụ thể.
- [ ] Có đối chiếu JSON cho save/load/export/import, cùng bằng chứng thao tác history; không dùng counts thay cho chứng minh.
- [ ] Provider thật được ghi rõ `PASS`, `FAIL`, `BLOCKED` hoặc `NOT_RUN`, tách khỏi mock/import coverage.
- [ ] Mọi FAIL/BLOCKED đều liên kết issue hoặc nguyên nhân môi trường có thể hành động; không còn check chưa có trạng thái.
- [ ] Báo cáo phân biệt rõ **đã kiểm tra**, **đang lỗi**, **chưa kiểm tra**, và đề xuất slice sửa đầu tiên.
- [ ] Không thay logic sản phẩm, dependency versions hoặc lockfile để làm đẹp kết quả; liệt kê chính xác file test/tài liệu đã thêm.

**Kết luận được phép:** “Đã chốt baseline V1 trên bộ case và môi trường này; các phần pass, lỗi và giới hạn coverage được ghi trong báo cáo.”

**Kết luận chưa được phép chỉ từ Step 1:** “Kora đã hoàn thành V1”, “AI hiểu mọi prompt”, hoặc “production-ready”.
