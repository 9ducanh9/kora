# Kora — Step 2: Làm chắc DiagramDocument và validation

Ngày soạn: 2026-10-17  
Trạng thái: Core validation/ingestion đã triển khai; targeted offline tests và typecheck pass. Full V01–V23, browser acceptance và build còn chờ. Xem [báo cáo Step 2](../validation/20261017-2109/report.md).  
Thư mục dự án: `D:\Project\Kora`  
Tài liệu liên quan: [Kora V1](../../kora_initial_spec.md), mục 8–11 và 18; [Step 1 — Baseline V1](./step-1-v1-baseline.md).

## 1. Mục tiêu

Mọi dữ liệu đưa vào canvas phải qua kiểm tra runtime. Dữ liệu lỗi không được làm mất diagram đang mở, làm sai history hoặc ghi đè bản đã lưu. Dữ liệu hợp lệ phải giữ được semantics và vị trí người dùng đã chỉnh.

Step 2 phải tạo ra các hành vi sau:

1. Import JSON và load localStorage dùng cùng một bộ kiểm tra `DiagramDocument`.
2. Generate chỉ thay diagram sau khi IR, normalization, layout và Document cuối đều hợp lệ.
3. Auto Layout giữ nguyên semantics và chỉ áp dụng presentation hợp lệ.
4. Asset không tìm thấy được hiển thị bằng fallback có cảnh báo, vẫn giữ danh tính service gốc.
5. UI phân biệt được không có bản lưu, bản lưu lỗi và storage không dùng được; chỉ báo Save thành công sau khi ghi thành công.
6. Kết quả xử lý bất đồng bộ cũ không được ghi đè diagram hoặc thao tác mới hơn.

Khác với bước đo baseline, Step 2 là bước sửa sản phẩm. Các yêu cầu an toàn dữ liệu và validation trong spec này phải pass mới được nghiệm thu; ghi lỗi vào backlog không thay thế việc hoàn thành chúng.

## 2. Phạm vi và quan hệ với Step 1

### Trong phạm vi

- Runtime schema cho Document, semantic integrity và presentation integrity.
- Chính sách lỗi/cảnh báo nhất quán cho IR, assets, Document và storage.
- Nạp dữ liệu qua startup restore, Load, Import, Generate và Auto Layout.
- Validate snapshot trước Save/Export; trả kết quả lưu rõ ràng cho cả toolbar và Ctrl+S.
- Thay Document nguyên tử, đúng history và có kiểm tra kết quả bất đồng bộ còn hợp lệ.
- Test lỗi dữ liệu, storage, history, round trip và warning đi qua các tầng.

### Ngoài phạm vi

- Hoàn thiện kéo nhiều node, kéo subtree, resize hoặc xóa container; đây là Step 3.
- Tối ưu bố cục, routing, overlap và độ dễ đọc của diagram; đây là Step 4.
- Nâng chất lượng diễn giải prompt, thay model/provider hoặc đổi system prompt.
- Autosave mọi thao tác, quản lý nhiều diagram, đồng bộ cloud, auth hoặc deployment.
- Đồng bộ viewport thực tế của React Flow vào Document; Step 2 chỉ kiểm tra và giữ nguyên viewport được lưu.

Khi triển khai, đọc báo cáo Step 1 nếu đã có. Hiện có spec Step 1 không đồng nghĩa baseline đã chạy. Nếu chưa có fixture/báo cáo, tạo fixture tối thiểu theo spec đó cho test Step 2 và ghi rõ nguồn; không tuyên bố baseline hoàn thành.

Không thay version dependency hay lockfile nếu công việc có thể dùng Zod, tsx và các package hiện có.

## 3. Hiện trạng cần sửa

Các nhận xét dưới đây được xác nhận từ source khi soạn spec, chưa phải kết quả test runtime:

| Nguồn | Hiện trạng | Thay đổi yêu cầu |
| --- | --- | --- |
| `core/diagram/storage.ts` | `JSON.parse` rồi ép kiểu; import chỉ kiểm tra vài field ở top level | Nhận `unknown`, kiểm tra đầy đủ trước khi trả Document |
| `core/diagram/storage.ts` | Load trả `null` cho cả không có dữ liệu, JSON lỗi và storage lỗi | Trả kết quả phân biệt từng trường hợp |
| `core/diagram/storage.ts` | Save nuốt lỗi và trả `void` | Trả kết quả thành công/thất bại; UI dùng kết quả đó |
| `core/ir/validator.ts` | Xóa membership không tồn tại; tự đổi duplicate edge ID bằng số ngẫu nhiên | Từ chối ambiguity và broken references, không sửa ngầm |
| `core/assets/registry.ts` | `resolveAsset` trả generic fallback khi miss | Bổ sung kết quả resolution chi tiết; không dựa vào truthiness để phát hiện miss |
| `core/ai/providers/*` | Trả model đã validate, làm mất warnings trước khi client validate lại | Truyền structured issues qua parser, API và pipeline |
| `core/pipeline/generationPipeline.ts` | Chưa kiểm tra Document sau ELK | Validate kết quả cuối trước khi cho phép commit |
| `app/page.tsx` | Chỉ restore bản lưu có ít nhất một node | Restore cả Document rỗng hoặc chỉ có containers nếu hợp lệ |
| `components/toolbar/CanvasToolbar.tsx` | Auto Layout gọi normalization rồi suy ra semantic change bằng số containers | Dùng semantics hiện tại; không suy ra tính tương đương chỉ từ counts |
| Page, PromptHeader và toolbar | Callback async giữ snapshot `doc` từ lúc bắt đầu | Kiểm tra revision/token và lấy previous snapshot lúc commit |

Các path trong bảng nằm dưới `src/`. Zod parse hiện tạo dữ liệu đã parse riêng; không mô tả code cũ là chắc chắn sửa trực tiếp object raw của caller. Tuy vậy, code mới vẫn phải có test chứng minh input và Document đang mở không bị mutate.

## 4. Kiến trúc và contract chung

Giữ `DiagramDocument` là state chuẩn. Dùng một bộ quy tắc semantic chung cho IR dạng arrays và Document dạng records; không tạo hai validator có chính sách khác nhau.

### 4.1. Kết quả validation

Contract đề xuất:

```ts
type ValidationIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  path: Array<string | number>;
  message: string;
  entityId?: string;
};

type ValidationResult<T> =
  | { ok: true; value: T; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

validateArchitectureModel(raw: unknown): ValidationResult<KoraArchitectureModel>;
validateDiagramDocument(raw: unknown): ValidationResult<DiagramDocument>;
decodeDiagramDocument(json: string): ValidationResult<DiagramDocument>;
```

- Có ít nhất một `error` thì không có `value` hợp lệ để commit.
- `warning` cho phép tiếp tục nhưng phải đến được UI; `info` dùng cho thay đổi an toàn như alias được resolve.
- `path` xác định field lỗi, ví dụ `['semantic', 'nodes', 'backend-a', 'containerId']`.
- Kết quả có thứ tự ổn định; cùng input cho cùng codes và kết quả, không random ID.
- Không sửa input hoặc snapshot đang mở; khi lỗi không trả object đã sửa một phần.
- Validation không đọc localStorage, gọi network, chạy layout hay dispatch command.

`JSON.parse` phải trả `unknown`. Bắt lỗi JSON syntax tại decoder; không dùng `as DiagramDocument` như bằng chứng dữ liệu hợp lệ. Không đọc `.nodes`, tính counts hoặc truy cập metadata từ input chưa qua schema.

### 4.2. Trình tự xử lý

```text
Generate:
unknown IR → schema + semantic validation → asset resolution
→ AWS normalization → semantic validation lại → ELK
→ Document validation → kiểm tra operation còn hợp lệ → commit

Startup / Load / Import:
JSON → decode → Document schema + semantic + presentation validation
→ asset diagnostics → kiểm tra operation còn hợp lệ → commit

Auto Layout:
snapshot Document hợp lệ → ELK trên semantics hiện tại
→ ghép presentation mới vào snapshot → Document validation
→ kiểm tra operation còn hợp lệ → commit

Save / Export:
snapshot Document hiện tại → Document validation → serialize
→ ghi storage hoặc khởi tạo download → thông báo kết quả thật
```

Load/Import không chạy AWS normalization hoặc ELK. Người dùng đã chỉnh diagram thì mở lại phải giữ nguyên diagram đó.

## 5. Quy tắc dữ liệu

### 5.1. Runtime schema của Document

Tạo `DiagramDocumentSchema` bằng Zod, tái sử dụng enum/schema IR. TypeScript type và runtime schema phải cùng contract, ưu tiên derive type từ schema hoặc có kiểm tra type tương đương.

| Nhóm | Yêu cầu |
| --- | --- |
| Version | Chính xác chuỗi `"1.0"`; version khác bị từ chối rõ ràng |
| Cấu trúc | Có `semantic`, `presentation`, `metadata` đúng kiểu object; có đầy đủ các records nodes/connections/containers và viewport theo type hiện có |
| Field lạ | Từ chối field chưa hỗ trợ ở các object cấu trúc thay vì silently strip; các map metadata được định nghĩa trong IR vẫn cho phép keys tùy ý với value đúng kiểu |
| ID | Chuỗi không rỗng và không chỉ gồm khoảng trắng; không tự trim/đổi ID; cấm các ID/map keys `__proto__`, `constructor`, `prototype` để records dùng như dictionaries an toàn |
| Labels | Node/container label và document title không rỗng sau khi xét whitespace; giữ nguyên nội dung hợp lệ, không tự sửa text |
| Metadata | `title`, `createdAt`, `updatedAt` bắt buộc; timestamps là ISO 8601 hợp lệ có timezone; không bắt `updatedAt >= createdAt` vì clock có thể lệch |
| Node presentation | `x`, `y` là số hữu hạn; `width`, `height` nếu có phải hữu hạn và lớn hơn 0; `selected` nếu có là boolean |
| Container presentation | Có `x`, `y` hữu hạn và `width`, `height` hữu hạn, lớn hơn 0; `selected` nếu có là boolean |
| Viewport | `x`, `y` hữu hạn, `zoom` hữu hạn và lớn hơn 0; không reject chỉ vì khác min/max zoom của UI |

Cho phép tọa độ âm, số thập phân, Document hoàn toàn rỗng, container rỗng và Document chỉ có containers. Node dimensions optional theo contract V1 hiện có; không tự thêm kích thước khi load.

Field optional được phép vắng mặt, nhưng sai kiểu hoặc `null` không được biến thành missing. Không coercion chuỗi số, không dựng metadata/tọa độ mặc định để che dữ liệu thiếu. Những field bắt buộc thiếu phải báo lỗi.

### 5.2. Semantic integrity

- IR arrays: node IDs, container IDs và connection IDs phải unique trong từng tập.
- Node và container dùng chung namespace cho canvas nodes, nên không được trùng ID với nhau. Connection IDs dùng namespace riêng; không cấm trùng với node chỉ vì cùng chuỗi.
- Document records: mỗi key bằng chính xác `value.id`; không tự re-key. Kiểm tra own keys, không coi thuộc tính kế thừa là một thực thể.
- Mọi connection source/target phải là node đang tồn tại. Container không được làm endpoint trong V1.
- `containerId` của node và `parentId` của container nếu có phải tham chiếu container tồn tại.
- Không self-parent, không container cycle ở bất kỳ độ sâu nào. Một container có tối đa một parent theo schema.
- Giữ parallel edges có ID riêng, self-loop của node và graph có chu trình; chu trình network/data-flow không phải container cycle.
- Enum kind, relationship, container type, scope và origin phải đúng catalog/schema hiện có.
- Không biến validator thành bộ thiết kế AWS: không tự thêm service hoặc suy diễn VPC/subnet membership từ tên asset.

Missing node membership là **error cho cả IR mới và Document đã lưu**. Duplicate connection ID cũng là error. Đây là thay đổi có chủ đích so với hành vi clear/randomize hiện tại; caller nhận thông báo để sửa nguồn, thay vì nhận diagram đã mất thông tin.

### 5.3. Presentation integrity và giới hạn kiểm tra

Tập keys `semantic.nodes` phải bằng tập keys `presentation.nodes`; quy tắc tương tự cho containers. Không thiếu presentation, không có presentation thừa, không đặt container vào map của service node.

Sai loại object, nonfinite geometry hoặc dimensions không hợp lệ là error. Kiểm tra trực tiếp `NaN`/`Infinity` trên object trong memory, không chỉ JSON, vì JSON không biểu diễn chúng như số hợp lệ.

Overlap và child nằm ngoài bounding box của container sau manual drag **không phải lỗi cấu trúc**. Vẫn được lưu/mở lại, giữ membership theo semantics. Full bounds và overlap dùng để đo chất lượng layout ở Step 1/4; không dùng chúng làm lý do làm mất bản chỉnh tay. Step 2 không tự reparent node dựa vào vị trí.

### 5.4. Tương thích dữ liệu V1 cũ

- Giữ format `version: "1.0"` và storage key `kora:diagram:v1`.
- Bản cũ đủ schema và reference integrity phải load được, kể cả chưa có AWS Cloud boundary hoặc có nhiều cloud containers với ID riêng. Ghi warning `AWS_CLOUD_NONCANONICAL`; không tự gộp, thêm boundary hoặc đổi tọa độ khi load/save.
- Không có migration tự động cho Document thiếu required fields, unknown version hoặc có reference lỗi. Báo lỗi cụ thể và giữ raw saved value để có thể khôi phục; không thay bằng diagram rỗng rồi autosave đè lên.
- Không đổi createdAt/updatedAt chỉ vì validate, load hoặc export. Việc người dùng chỉnh sửa/generate mới cập nhật metadata như command hiện có.
- Unknown structural fields bị từ chối cùng path cụ thể; không giả định đây là format V1 mới hơn đã được hỗ trợ.

## 6. Asset resolution và warning

Bổ sung API resolution chi tiết trong registry; giữ API `resolveAsset` hiện có cho renderer nếu cần tương thích. Kết quả phải phân biệt `canonical`, `alias`, `label-derived`, `fallback`, kèm node ID, giá trị được yêu cầu và resolved ID nếu có.

| Input | Kết quả và mức độ |
| --- | --- |
| ID canonical có trong registry | Dùng asset đó, không warning |
| Alias biết trước, ví dụ `ALB` | Resolve có `info: ASSET_ALIAS_RESOLVED`; generated IR có thể dùng canonical ID trên bản copy |
| Không có assetId, label match được catalog | Resolve có `info: ASSET_FROM_LABEL`; không suy ra membership |
| Unknown assetId hoặc label không match | Renderer dùng fallback, `warning: ASSET_FALLBACK`; giữ node, label, kind và giá trị assetId gốc nếu có |
| Người dùng chọn `generic.component` rõ ràng | Generic có chủ đích, không tính là unresolved asset |

Document được load/import/save/export không bị canonicalize assetId trên đĩa; chỉ resolve để render và báo issues. Giữ geometry và danh tính service gốc. Không tự dùng label để che một assetId explicit nhưng sai: cảnh báo chính ID đó trước khi fallback.

`resolveAsset` hiện trả fallback ngay cả khi miss, nên kiểm tra `if (asset)` không chứng minh resolve thành công. Diagnostics phải dùng outcome chi tiết và đếm **fallback do không resolve được**, không gom generic có chủ đích vào lỗi.

Warnings không chỉ nằm trong console. UI có summary ngắn và vùng xem chi tiết theo entity, ví dụ: “Không tìm thấy icon cho Backend A; đang dùng biểu tượng chung.” Các info alias không cần toast riêng.

### Truyền issues qua parser → API → pipeline → UI

Đổi kết quả `ArchitectureParser.parse` thành envelope có `model` và `issues`; cập nhật cả DeepSeek, Gemini, mock cùng các callers/tests. Không để provider trả model đã sửa nhưng bỏ mất thông tin về nguồn.

- API success trả `{ success: true, model, parser, issues }`.
- Client coi `model` nhận qua network là `unknown`, vẫn validate lại; không tin dữ liệu chỉ vì server nói success.
- Pipeline result có issues tổng hợp từ parser, validation và asset resolution. Deduplicate theo severity/code/path/entity; không gộp hai node khác nhau thành một cảnh báo.
- Validation failures dùng lỗi có cấu trúc, code và issues; không chỉ nối thành một chuỗi không thể xử lý.
- Invalid model từ provider trả lỗi upstream có cấu trúc, không trả `success: true`. Có thể dùng HTTP 502 cho output provider không hợp lệ; request sai định dạng là 400. Giữ luồng credential hiện có ngoài thay đổi này.
- Không đưa raw response, API key hoặc stack trace vào thông báo UI. Issue message/path/entity đủ để xác định dữ liệu lỗi.

Issues là diagnostics của lần nạp/kiểm tra, không trở thành semantic entities hoặc field mới bắt buộc trong Document V1.

## 7. Quy tắc cho từng đường vào/ra

| Luồng | Hành vi bắt buộc |
| --- | --- |
| Startup restore | Chỉ `engine.reset` sau validation thành công; phục hồi cả empty/container-only Document; bắt đầu history rỗng |
| Không có bản lưu | Trạng thái bình thường, mở prompt như hiện tại; không báo “bản lưu hỏng” |
| Bản lưu lỗi | Không render dữ liệu lỗi; mở workspace an toàn, thông báo bản lưu không đọc được; giữ nguyên raw value, không tự xóa/ghi đè |
| Load người dùng bấm | Validate trước; thành công là một replacement command có Undo/Redo; lỗi giữ nguyên canvas/history/storage |
| Import file | Bắt cả lỗi đọc file và JSON/schema/reference; validate xong mới thay Document một lần; không tự ghi localStorage |
| Generate | Validate ở mọi stage; chỉ commit Document hoàn chỉnh; tự lưu sau commit như hiện tại, nhưng báo riêng nếu lưu thất bại |
| Auto Layout | Validate snapshot đầu vào; layout trên semantics hiện tại, không normalization; thay đúng presentation qua một command; semantics/title/createdAt không thay đổi |
| Save / Ctrl+S | Lấy snapshot từ engine tại thời điểm bấm, validate/serialize trước, ghi storage một lần; chỉ báo saved khi thành công |
| Export | Validate snapshot trước khi serialize/khởi tạo download; lỗi không dispatch command hoặc thay storage; success nghĩa là bắt đầu tải xuống, không xác nhận file đã có trên đĩa |

Generate cần validate lại semantics sau `prepareArchitectureModel`. Nếu normalization định thêm `cloud-aws` nhưng ID đó đã bị một node/container khác chiếm, phải trả `NORMALIZATION_ID_CONFLICT` trước khi ghi đè. Không tự đổi ID của thực thể gốc. ELK dùng sentinel `root`: nếu có entity ID xung đột, trả `LAYOUT_ID_CONFLICT` rõ ràng trước layout; thay cách cấp internal IDs thuộc cải tiến layout sau này.

Các collision trên là lỗi của operation Generate/Auto Layout, không phải lý do từ chối một bản đã lưu vốn vẫn render hợp lệ. Generated Document chỉ được commit khi kiểm tra key parity và schema cuối cùng pass.

Auto Layout không dùng check “số containers có thay đổi không” để quyết định cập nhật semantics. Dùng đúng semantics của snapshot đầu vào, chỉ lấy geometry nodes/containers từ ELK, giữ viewport của snapshot thay vì dùng default viewport ELK trả về, cập nhật updatedAt do đây là thao tác chỉnh sửa. Nếu ELK trả presentation sai, từ chối toàn bộ layout và giữ diagram cũ.

### 7.1. Kết quả storage rõ ràng

Load trả union phân biệt tối thiểu:

- `missing`: key không có dữ liệu.
- `loaded`: Document đã validate và issues.
- `invalid`: có raw value nhưng JSON/Document không hợp lệ, kèm issues.
- `unavailable`: đọc storage thất bại, ví dụ browser từ chối truy cập.

Save trả success hoặc lỗi validation/serialization/storage. Validate và serialize xong mới gọi `setItem`; không remove key cũ trước khi write, không retry bằng cách ghi Document rỗng. Truy cập `window.localStorage` cũng phải nằm trong error handling, không chỉ `getItem`/`setItem`.

Storage API có thể nhận adapter tối thiểu để test read/write failures trong memory; không thêm database. Giữ import/export file là adapter bên ngoài pure validator.

### 7.2. Thông báo phải đúng kết quả

- Save fail: “Không lưu được vào trình duyệt. Diagram hiện tại vẫn đang mở.”
- Generate pass, save fail: “Đã tạo diagram; chưa lưu được vào trình duyệt.” Giữ diagram vừa tạo và bản lưu cũ.
- Import fail: “Không mở được diagram: Backend A tham chiếu subnet không tồn tại.” Giữ diagram đang mở.
- Load invalid khác với “Chưa có diagram được lưu”.
- Lỗi hoặc warning phải có thể đọc lại sau toast; dùng panel/summary gọn, không yêu cầu người dùng mở DevTools.

Khi chỉ đọc bản lưu lỗi, giữ raw bytes tại key hiện có. Một lần Generate/Save mới do người dùng chủ động thực hiện vẫn được phép thay bản lưu theo hành vi của sản phẩm; không thêm luồng xác nhận ngoài phạm vi.

## 8. Atomic replacement, history và bất đồng bộ

Thêm một đầu mối acceptance ở workspace cho các operation thay Document; tránh mỗi component tự decode, validate, dispatch và báo success theo cách khác nhau. Không đưa validate toàn bộ graph vào từng pointer update của editor.

### 8.1. Trình tự commit

1. Ghi operation token và revision hiện tại khi bắt đầu đọc file/generate/layout.
2. Xử lý trên candidate riêng, không sửa engine hoặc storage.
3. Validate candidate; nếu fail, chỉ công bố issues khi token còn là operation mới nhất, không dispatch.
4. Kiểm tra token còn là operation mới nhất và revision chưa đổi.
5. Lấy `engine.getDocument()` ngay lúc commit làm previous snapshot.
6. Dispatch đúng một command. Explicit Load/Import/Generate là một bước Undo; Auto Layout là một bước Undo presentation. Startup restore dùng reset.
7. Với Generate, lưu sau commit và báo đúng kết quả persistence.

Revision là counter tăng sau mọi dispatch/undo/redo/reset được chấp nhận. Không dùng riêng `updatedAt`, vì timestamp không phải revision đáng tin. Không cần đổi format Document hoặc persist revision.

Nếu document đã thay đổi lúc operation đang chờ, bỏ kết quả cũ và hiện thông báo ngắn để người dùng chạy lại. Chọn cơ chế revision/token thay vì khóa toàn editor. Import/Generate/Load/Clear mới và việc đóng drawer phải vô hiệu hóa kết quả Generate cũ; không để close drawer rồi request hoàn tất vẫn thay diagram. Có thể hủy request khi phù hợp, nhưng stale check là bắt buộc kể cả hủy không kịp.

Kiểm tra token sau mọi điểm chờ và trước mọi thông báo lỗi/success, cập nhật issues hoặc cleanup trạng thái loading trong `finally`. Token đã bị operation mới thay thế phải kết thúc im lặng; chỉ operation vẫn sở hữu token nhưng revision đổi mới được báo cần chạy lại. Như vậy lỗi read/validation trả muộn cũng không đè thông báo của operation mới.

Drag hoặc inline edit có thể đã bắt đầu nhưng chưa dispatch command. Thông báo bắt đầu chỉnh sửa từ canvas/editor phải vô hiệu hóa candidate đang chờ trước khi nó commit; không chờ đến drag stop/blur mới phát hiện bằng revision. Đây chỉ là bảo vệ acceptance, không thay đổi cách drag/edit được ghi history của Step 3.

### 8.2. Invariants cần chứng minh

- Validation/read/layout failure và stale completion không thay Document, undo stack, redo stack hoặc storage; không phát success toast.
- Candidate được chấp nhận thay state một lần. Replacement commands phục hồi đầy đủ snapshot Document liền trước/liền sau khi Undo/Redo, không dùng snapshot cũ từ lúc bắt đầu async. Auto Layout phục hồi chính xác geometry trước/sau và giữ semantics/viewport; updatedAt được cập nhật theo chính sách edit command hiện có, nên không yêu cầu timestamp của layout Undo bằng snapshot cũ.
- Undo một replacement rồi thực hiện operation lỗi phải giữ được redo cũ.
- Không có hai replacement hoàn tất đảo thứ tự rồi kết quả cũ thắng.
- Save fail sau Generate thành công là lỗi persistence, không rollback diagram vừa tạo. Save thông thường fail không làm thay canvas/history.
- Panel issues của operation cũ không được ghi đè issues/status của operation mới hơn.

Không sửa toàn bộ command engine trong bước này. Chỉ bổ sung revision/read-only state cần thiết và acceptance helper; các vấn đề thao tác editor quan sát từ Step 1 tiếp tục ở Step 3.

## 9. File và module dự kiến

Tên file có thể chỉnh theo conventions thực tế; trách nhiệm phải giữ như sau:

```text
src/core/validation/types.ts          # Issue và ValidationResult dùng chung
src/core/ir/schema.ts                 # Schema semantic, reuse cho Document
src/core/ir/validator.ts              # Semantic integrity, không repair ngầm
src/core/assets/registry.ts           # Detailed resolution, giữ renderer API
src/core/diagram/schema.ts            # Runtime DiagramDocument schema
src/core/diagram/validator.ts         # Key parity, references, geometry integrity
src/core/diagram/storage.ts           # Decode/load/save/export outcomes
src/core/diagram/useDocumentOperations.ts
                                     # Workspace acceptance + token/revision
src/core/commands/commandEngine.ts    # Revision, giữ contract history
src/core/ai/parser.interface.ts       # Parse result chứa issues
src/core/ai/providers/*               # Trả diagnostics, lỗi có cấu trúc
src/core/pipeline/generationPipeline.ts
                                     # Validate trước/sau normalization/layout
src/app/api/parse-architecture/route.ts
src/app/page.tsx                      # Startup, Ctrl+S, acceptance coordinator
src/components/prompt/PromptHeader.tsx
src/components/toolbar/CanvasToolbar.tsx
src/components/canvas/*              # Báo bắt đầu chỉnh sửa để hủy candidate cũ
src/components/validation/ValidationNotice.tsx
tests/fixtures/validation/*
scripts/test-document-validation.ts
scripts/test-document-ingestion.ts
```

Cập nhật mock fixtures và scripts hiện có nếu parser/validation contracts đổi. Có thể gom helper nếu ít code, không cần thêm state-management library. Detailed asset resolver và pure validator dùng được cả server/client; storage/browser hook không được bị import vào provider phía server.

## 10. Test bắt buộc

### 10.1. Unit và integration offline

Dùng fixtures tối thiểu của Step 1 và các bản sao có đúng một lỗi cần kiểm tra. Dùng fake storage/provider và deferred promises; không gọi API có phí để chứng minh validation.

| ID | Case | Kỳ vọng |
| --- | --- | --- |
| V01 | B1/B2/B3 hợp lệ, empty Document, container-only, empty container có presentation đúng | Pass, không mất thực thể |
| V02 | JSON hỏng, `null`, array thay root object, version thiếu/sai | Structured error, không throw TypeError do đọc field sớm |
| V03 | Required field thiếu, field sai kiểu, enum lạ, structural field lạ | Error đúng code/path; không coercion/strip |
| V04 | Duplicate IDs trong IR; node/container trùng; record key khác value.id; reserved IDs | Reject, không random rename/re-key |
| V05 | Source/target thiếu hoặc trỏ container | Reject, giữ đầy đủ error locations |
| V06 | Membership/parent không tồn tại, self-parent, container cycle sâu | Reject; không clear membership |
| V07 | Parallel edges và node self-loop | Pass nếu references hợp lệ |
| V08 | Missing/extra presentation key; container ở map node | Reject, gồm empty-container classification lỗi |
| V09 | NaN/Infinity, zero/negative dimension, zoom không dương | Reject; test trực tiếp object trong memory |
| V10 | Tọa độ âm/thập phân, overlap hoặc manual drag ra ngoài boundary | Pass; save/load giữ nguyên geometry và membership |
| V11 | Document V1 cũ chưa có Cloud/multiple Clouds khác ID | Pass có warning; không chạy ELK/normalization |
| V12 | Canonical/alias/label-derived/unknown/explicit generic assets | Đúng outcome, warning và fallback counts; unknown ID không bị xóa |
| V13 | Frozen raw input; validate hai lần | Không mutation; cùng kết quả sau khi xét thứ tự record keys ổn định |
| V14 | Load missing/corrupt/access denied; Save quota/write denied | Phân loại đúng; raw saved value cũ còn nguyên |
| V15 | Import/load/generate/layout lỗi khi có cả undo và redo | Document/history/storage không đổi; redo cũ vẫn hoạt động |
| V16 | Import/load/generate hợp lệ và Auto Layout thành công, Undo/Redo | Replacement phục hồi đầy đủ snapshot; layout phục hồi geometry, giữ semantics/viewport và áp dụng timestamp policy đã định |
| V17 | Pipeline normalization collision, `root` layout collision, layout trả sai map | Error trước commit; không overwrite thực thể |
| V18 | Warning từ fake provider qua parser/API/client pipeline | UI acceptance nhận đủ issues; không mất hoặc nhân đôi warnings |
| V19 | Delayed Generate/Import/Layout, sau đó edit/undo/load/clear/close drawer; gồm drag/inline edit chưa commit | Kết quả stale bị bỏ; không ghi storage hoặc báo success; lỗi/finally cũ không đè status mới |
| V20 | Hai operation hoàn tất ngược thứ tự | Chỉ operation còn hiệu lực được commit |
| V21 | Generate pass nhưng storage write fail | Canvas mới được giữ; storage cũ giữ nguyên; thông báo chưa lưu |
| V22 | Save/export/import/load round trip với diagram chỉnh tay | Giữ semantics, metadata và toàn bộ presentation, không relayout |
| V23 | FileReader lỗi, serialization/download setup lỗi | Thông báo đúng, không replacement/history/storage side effect |

Assertions về history phải kiểm tra nội dung trước/sau Undo/Redo và redo cursor thực tế, không chỉ `canUndo`. Assertions về storage so sánh raw string trước/sau failure. Không gọi một test pass nếu chỉ có console log.

Lỗi empty-container trong layout nếu vẫn tồn tại phải được validator phát hiện và operation bị từ chối an toàn; không giảm key-parity rule để làm test xanh. Test empty-container hợp lệ dùng Document có đúng presentation. Việc sửa bố cục/adapter đó có thể nằm ở Step 4 và phải được báo rõ; không tuyên bố đã sửa chỉ vì Step 2 từ chối dữ liệu lỗi.

### 10.2. Browser acceptance

Trên browser profile/origin local riêng, với diagram B2 đang mở và đã Save:

1. Import file hỏng, sai version và dangling endpoint: có lỗi dễ hiểu; canvas, Undo/Redo và bản lưu không đổi.
2. Import Document hợp lệ đã kéo node sang vị trí riêng: đúng vị trí, Undo quay lại B2, Redo quay lại bản import.
3. Reload với bản lưu hợp lệ rỗng/container-only; sau đó với saved JSON lỗi: phân biệt rõ kết quả, giữ raw dữ liệu lỗi và không crash workspace.
4. Import unknown asset: node vẫn tồn tại, dùng generic fallback, thấy warning và original asset identity trong chi tiết; Save/Export vẫn giữ ID gốc.
5. Save bằng toolbar và Ctrl+S khi storage adapter giả lập failure: không thấy toast saved; diagram vẫn chỉnh được. Test seam chỉ phục vụ kiểm tra, không thêm test route công khai vào sản phẩm.
6. Làm chậm Generate/layout/import, chỉnh diagram hoặc mở bản khác rồi cho operation cũ hoàn tất: diagram mới hơn còn nguyên.
7. Generate Quick Test B2 và Auto Layout: pipeline hợp lệ commit đúng một lần, không làm mất labels/hierarchy; Save → reload → sửa tiếp được.

Lưu screenshots cho notices, snapshot JSON và kết quả history/storage. Có thể dùng adapter/fake provider trong test harness cho failure path khó tạo; ghi rõ test nào là browser thật, test nào là integration fake. Không thay browser test bằng counts từ `renderedCounts`.

## 11. Trình tự triển khai và verification

1. Đọc baseline nếu có; xác nhận repo root, instructions và các thay đổi có sẵn. Giữ nguyên nội dung ngoài phạm vi.
2. Tạo shared issue/result types, schema và validators; thêm test V01–V13.
3. Thêm detailed asset resolution và truyền issues qua parser/API/pipeline; cập nhật tất cả callers.
4. Chuyển storage sang tagged results, test failures và round trip trước khi nối UI.
5. Thêm workspace acceptance, revision/token và startup/load/import/generate/layout integration.
6. Nối Save/Ctrl+S/Export cùng notices; chạy test history, stale results và storage failure.
7. Typecheck/build toàn bộ code cuối; chạy regression offline và browser acceptance; ghi kết quả cùng giới hạn còn lại.

Lệnh dự kiến từ `D:\Project\Kora`, dùng binary local:

```powershell
.\node_modules\.bin\tsx.cmd scripts/test-document-validation.ts
.\node_modules\.bin\tsx.cmd scripts/test-document-ingestion.ts
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
npm.cmd run build
npm.cmd run test:golden
.\node_modules\.bin\tsx.cmd scripts/test-containers.ts
.\node_modules\.bin\tsx.cmd scripts/test-compact-nodes.ts
```

Chạy thêm `test:parser` với `GEMINI_API_KEY` bị cô lập như hướng dẫn Step 1, và lint nếu đã cấu hình. Không tự chạy `test:deepseek` cho việc kiểm tra offline. Nếu baseline runner đã tồn tại, chạy lại nó để phân biệt regression mới với lỗi đã ghi nhận.

Test mới phải trả nonzero khi fail. Nếu lint/config hoặc một check baseline đã lỗi từ trước, ghi chính xác và không gọi đó là pass; nó không thay thế các test bắt buộc của Step 2. Nếu bug cũ làm không thể chứng minh một yêu cầu Step 2, yêu cầu đó còn chưa hoàn thành.

Deliverables khi thực hiện: source thay đổi đúng phạm vi, test fixtures/runners, log verification và báo cáo `docs/validation/<run-id>/report.md`. Báo cáo gồm contract thay đổi, compatibility behavior, test matrix, lỗi baseline còn lại và bằng chứng rằng failure paths giữ nguyên dữ liệu/history. Spec này chỉ định nghĩa công việc; chưa tạo các deliverables triển khai đó.

## 12. Điều kiện nghiệm thu

- [ ] Có một bộ validation runtime chung, phân biệt IR và persisted Document mà không nhân đôi semantic rules.
- [ ] Tất cả ingress và Save/Export dùng validator; không còn cast JSON chưa kiểm tra rồi đưa vào engine.
- [ ] Invalid version/schema/IDs/references/cycles/presentation bị từ chối với code/path; không repair ngầm identity hoặc membership.
- [ ] Load/import giữ nguyên semantics, geometry và metadata của bản hợp lệ; empty/container-only cũng restore được.
- [ ] Unknown assets dùng fallback có cảnh báo, không mất node hoặc original asset ID; generic có chủ đích được phân biệt.
- [ ] Issues đi qua parser, API, pipeline và đến UI; revalidation không làm mất diagnostics.
- [ ] Validation/read/layout failures giữ nguyên canvas, undo/redo và saved value; replacement hợp lệ có đúng một Undo.
- [ ] Startup reset, manual replacement và post-generate save có hành vi riêng đúng spec; save failure không bị báo thành công.
- [ ] Revision/token chặn stale async results, gồm close drawer và operation hoàn tất đảo thứ tự.
- [ ] Auto Layout không sửa semantics hoặc normalize bản chỉnh tay; candidate sai bị từ chối trước commit.
- [ ] V01–V23 và browser acceptance có bằng chứng phù hợp; tests mới, typecheck và build pass, regression được đối chiếu với baseline.
- [ ] Báo cáo nêu rõ thay đổi đã kiểm tra, compatibility có chủ đích và vấn đề editor/layout còn dành cho bước sau.

**Kết quả mong đợi:** người dùng có thể tạo, mở, lưu và trao đổi Document hợp lệ một cách tin cậy; dữ liệu lỗi được giải thích và từ chối trước khi gây mất trạng thái đang làm việc.
