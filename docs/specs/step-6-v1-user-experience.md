# Kora — Step 6: Hoàn thiện trải nghiệm V1

Ngày soạn: 2026-10-17  
Trạng thái: Đã triển khai core workflow, persistence và SVG/PNG export; offline tests pass; browser acceptance bị chặn bởi SWC. Xem [báo cáo thực hiện Step 5–6](../experience/20261018-104520/report.md).  
Thư mục dự án: `D:\Project\Kora`  
Tài liệu liên quan: [Kora V1](../../kora_initial_spec.md), mục 16–24; [Step 2 — Validation](./step-2-document-validation.md); [Step 3 — Editor](./step-3-editor-transactions.md); [Step 4 — Layout/routing](./step-4-layout-routing.md); [Step 5 — Parser evaluation](./step-5-ai-parser-evaluation.md).

## 1. Mục tiêu

Hoàn thiện luồng **nhập prompt → tạo diagram → chỉnh sửa → tự lưu → đóng/mở lại → tiếp tục sửa → xuất file**. Người dùng phải biết diagram nào đang mở, prompt nào đã tạo nó, thay đổi nào đã được lưu, operation nào đang chạy và có thể làm gì khi lỗi.

Các kết quả bắt buộc:

1. Prompt thực sự tạo thành công được lưu cùng Document và khôi phục đúng khi Load/Import/Undo/Redo replacement.
2. Autosave chỉ lưu canonical commits; trạng thái Saved/Unsaved/Error phản ánh đúng snapshot đã ghi thành công.
3. Generate có progress theo stage thực, Cancel và Retry explicit; kết quả cũ không đè nội dung hoặc status mới.
4. Error/warning có thông tin và hành động phù hợp; Retry save không gọi lại AI.
5. Export JSON giữ dữ liệu chỉnh sửa và provenance; SVG/PNG xuất toàn diagram từ geometry/assets thật, đầy đủ labels/boundaries/connections.
6. Có bằng chứng browser cho một vòng sử dụng trọn vẹn, tách khỏi offline tests và parser-quality scores.

## 2. Phạm vi và phụ thuộc

### Trong phạm vi

- Optional prompt provenance trong Document, session draft và một coordinator cho Save/autosave.
- Generation lifecycle, abort/deadline, manual retry và error/status ownership.
- UI trạng thái lưu, prompt nguồn, export options; bàn phím/focus trong các flow được thay đổi.
- Shared export scene, standalone native SVG, PNG rasterized từ cùng SVG; fonts/assets offline.
- Legacy compatibility, unit/integration fixtures, browser QA và báo cáo `docs/experience/<run-id>/report.md`.

### Ngoài phạm vi

- Thay provider/model để cải thiện score AI, kiến trúc tư vấn, RAG/agent hoặc thêm loại input.
- Cloud sync, account/project library, nhiều bản lưu, backend database, collaboration hoặc merge nhiều tab.
- Public deployment, auth, billing, rate limiting và server cost controls; các mục đó thuộc Step 7.
- Selection-only export, viewport screenshot, PDF/PPT, export lại thành IR khác, SVG import, manual bend-point editor.
- Thêm chart/image generation, đổi toàn bộ visual design hoặc một canvas renderer thay React Flow.
- Khôi phục undo stack qua reload; history vẫn là session state.

Đọc lại source và các báo cáo Step 1–4 trước khi triển khai. Step 5 hiện là spec, không có nghĩa evaluator đã tồn tại hoặc parser đã đạt target. Step 6 dùng fake provider/captured IR để kiểm tra workflow; không cần chất lượng AI đạt target mới test được persistence/export. Các browser/build acceptance còn thiếu của Step 1–4 không tự được đóng bởi spec này.

## 3. Hiện trạng đã đọc

| Nguồn | Hiện trạng | Yêu cầu Step 6 |
| --- | --- | --- |
| `src/app/page.tsx` | Restore qua `engine.reset`; Generate thành công tự save, Save/Ctrl+S ghi riêng; toast tự mất | Một nơi sở hữu autosave/status, startup gate và replacement acceptance |
| `src/components/prompt/PromptHeader.tsx` | Prompt khởi tạo từ sample, giữ cục bộ; không gắn với Document | Tách draft khỏi provenance của diagram hiện tại |
| Cùng component | Token/revision guards; chưa abort HTTP/deadline; close chỉ invalidate; mode/key có thể thay khi đang chạy | Freeze attempt settings, Cancel/Retry và late-callback guards |
| `src/core/diagram/types.ts` / `src/core/diagram/schema.ts` | Metadata strict chỉ title/createdAt/updatedAt | Optional source extension, update type/schema/validator/round-trip đồng thời |
| `src/core/diagram/storage.ts` | Validate → serialize → `setItem`, có structured failures; một key `kora:diagram:v1` | Tái sử dụng; không ghi qua nhiều handlers cạnh tranh |
| `src/core/commands/commandEngine.ts` | Full-snapshot replacements, revision và notify Document; chưa có change descriptor | Biết edit hay replacement để rebase prompt, không đoán bằng timestamps |
| `src/core/diagram/operationCoordinator.ts` | Latest-operation token cho Generate/Import/Load/Layout | Giữ acceptance guard; không dùng token này cho read-only export/autosave |
| `src/app/api/parse-architecture/route.ts` / `src/core/ai/providers/deepseek.parser.ts` | `/api/parse-architecture`; chưa truyền abort signal xuống provider fetch | Nối cancellation/deadline cùng existing abstraction |
| `src/components/toolbar/CanvasToolbar.tsx` | Export chỉ là JSON; file I/O/status nằm trong toolbar | Export menu JSON/SVG/PNG; tách orchestration khỏi UI |
| `src/components/canvas/AwsConnectionEdge.tsx` | Smooth-step/self-loop fallback và label center là logic riêng | Dùng chung render geometry với export |
| `src/core/layout/visualMetrics.ts` | Có boxes/line counts, chưa có wrapped line runs | Shared text layout phục vụ renderer và native SVG |
| `src/app/globals.css` / assets | Fonts hiện tải Google CSS; icons/badges local SVG, có IDs lặp giữa file | Bundled licensed fonts, inline trusted assets và namespace refs |
| `src/components/canvas/KoraCanvas.tsx` | Absolute geometry, route-cache checks, Fit View; camera là session state | Export không phụ thuộc pan/zoom/DOM visibility; không re-layout |

Các nhận xét trên là đối chiếu source. Chưa phải bằng chứng mới về browser, file download hoặc việc provider dừng xử lý sau cancel.

## 4. Prompt nguồn và compatibility

### 4.1. Optional Document extension

Giữ Document `version: "1.0"`, storage key và cấu trúc semantic/presentation. Thêm optional metadata field:

```ts
interface DiagramSource {
  kind: 'prompt' | 'fixture';
  prompt: string;
  context?: { scope?: string };
  parser: { id: string; model?: string };
  generatedAt: string;
}

// DiagramDocument.metadata.source?: DiagramSource
```

- `prompt` là chuỗi thực sự submit của attempt được accept: giữ nguyên Unicode, xuống dòng và whitespace; validation chỉ dùng trim để kiểm tra không rỗng, không thay nội dung.
- `context` chỉ giữ các field đã gửi và có ý nghĩa với operation. Không thêm preferredRegion/context giả mà adapter chưa dùng.
- Parser ID/model lấy từ metadata thực tế; model không quan sát được thì omit, không tự khẳng định `deepseek-chat` từ nhãn UI. Parser ID lạ trong file import vẫn là provenance, không kích hoạt provider tương ứng.
- `generatedAt` là ISO timestamp có timezone do client ghi khi candidate được accept; không thay khi Save/autosave hoặc manual edits.
- Không lưu credential, headers, raw provider response, status/error, selection hoặc prompt draft vào source.
- Source là **prompt đã tạo diagram ban đầu**, không cam kết còn mô tả mọi chỉnh sửa tay. UI gọi rõ `Original prompt`, không ghi là nội dung đồng bộ từ graph hiện tại.

Type, strict Zod schema và validator phải được cập nhật đồng thời. Document V1 cũ thiếu source vẫn load/save/import được, không tự chèn sample/default provenance. Field sai kiểu hoặc source rỗng/timestamp lỗi bị từ chối như dữ liệu untrusted theo Step 2; không strip field để qua validation.

Đây là extension tương thích một chiều: app mới đọc V1 cũ; app V1 strict cũ có thể từ chối file mới có source, tương tự extension routes ở Step 4. Ghi rõ trong report; không đổi version/schema một cách ngầm định.

### 4.2. Atomic association

Gắn source vào **candidate Document trước final validation và replacement command**. Geometry, semantics và source được accept bằng đúng một transaction. Không set source riêng sau `dispatch` hoặc sau khi save thành công.

| Operation | Source/prompt association |
| --- | --- |
| Generate được accept | Candidate có source của chính attempt đó; một Undo phục hồi diagram và source cũ |
| Generate fail/cancel/stale | Không đổi source, Document, history/redo hoặc bản lưu |
| Move/rename/delete/reconnect/layout | Giữ source nguyên trạng; không viết lại prompt từ graph |
| Load/Import | Giữ source đã validate trong file; bản legacy không source phải hiển thị `No original prompt recorded` |
| Clear | Document mới không source; kể cả graph rỗng nhưng còn source thì Clear vẫn là replacement có ý nghĩa |
| Undo/Redo replacement | Khôi phục đúng full snapshot và source cùng nhau |
| Save/Export JSON | Serialize source đã commit; không lấy text đang gõ trong drawer |

Không dùng `createdAt`, `updatedAt`, title hoặc source text làm document ID. Có thể bổ sung change descriptor session-only cho engine subscriber (`edit`/`replacement`/`reset`, commit/undo/redo và revision), giữ subscribers cũ dùng được. `workspaceEpoch` tăng qua replacement/reset và Undo/Redo replacement; không persist epoch hoặc tạo command chỉ để đổi session state. Effective no-op theo Step 3 không tăng epoch, reset draft hoặc tạo notification/save mới chỉ vì intent được bấm.

## 5. Prompt draft và interaction settlement

- Draft thuộc workspace session, không thuộc canonical Document. Gõ, chọn sample, đóng/mở drawer không làm dirty diagram, tạo history hoặc thay source.
- Startup và accepted replacement seed draft từ source của Document mới. Với legacy/Clear thì draft rỗng và samples là lựa chọn rõ ràng; không giả sample là prompt nguồn.
- Ordinary edit/Undo edit/autosave/theme render không reset draft. Replacement/Undo-Redo replacement rebase draft theo source của snapshot mới; đây là ranh giới đổi diagram, không chờ blur component cũ.
- Close drawer giữ draft của session và Cancel attempt nếu có. Reload chỉ hứa khôi phục prompt đã tạo thành công; draft chưa submit/failed không được gọi là đã lưu.
- Nút `Restore original prompt` thay draft bằng source của diagram hiện tại; không gọi provider hoặc đổi Document. Disable khi không có source; không mượn source của diagram trước.
- Giữ credential UI hiện có tách khỏi provenance/draft serialization. Lỗi truy cập credential storage không được crash drawer; không mở rộng thành thiết kế auth mới trong bước này.

Mọi nút Save/Export/Generate/Load/Import/Clear và shortcuts phải đi qua settlement contract Step 3:

| Intent | Settlement trước khi tiếp tục |
| --- | --- |
| Save / Ctrl+S / Export | Commit label draft hợp lệ đúng một lần, đợi measurement hoàn tất; IME chưa xong thì cancel theo Step 3; cancel move/connect preview rồi lấy canonical snapshot |
| Generate / Load / Import đã chọn file / Clear / Undo/Redo | Cancel editor draft/gesture, chặn blur hoặc callback commit muộn; sau đó chạy operation |
| Autosave timer | Không blur/commit/cancel interaction; chỉ đọc canonical snapshot đã chốt |

Nếu label commit cần đợi fonts/measurement, settlement phải có Promise/ownership guard; không lấy snapshot trước khi commit rồi để rename đến sau. Settlement có deadline riêng tối đa 5 giây từ intent và có thể cancel: timeout dừng action, không dispatch rename hoặc bắt đầu Save/Export sau đó; giữ draft cho người dùng sửa/thử lại và báo lý do. Callback font/measurement đến muộn phải bị bỏ. Nếu Document đã bị thay thế lúc chờ, settlement cũ không được rename vào diagram mới. Save failure sau một settlement đã commit thành công không rollback rename đó.

Pan/zoom/Fit View vẫn là navigation session state theo Step 3–4: không history, không dirty/autosave hoặc đổi Document. `presentation.viewport` có trong file vẫn được giữ nguyên qua JSON round-trip; Step 6 không mở thêm tính năng lưu camera mới. Sau Generate/Load/Import có thể Fit View một lần để thấy toàn diagram; không đổi geometry hoặc persist camera ngầm.

## 6. Generation lifecycle, Cancel và Retry

### 6.1. Attempt ownership

Một attempt có `attemptId`, operation ticket, captured revision/epoch, frozen prompt/context/mode, transient credential reference, AbortController và deadline. Freeze tại Begin, không đọc lại mutable draft/settings trong async callbacks.

```text
idle → parsing → measuring/layout → applying → succeeded
                   │                   │
                   └→ failed/cancelled ←┘   (chỉ trước accept)
```

- Chỉ owner hiện tại được thay progress/error hoặc accept candidate. Progress đến từ stage thực, không dùng percent/timer giả.
- Disable prompt/sample/provider/key settings trong attempt; giữ Cancel và Close dùng được. API/model hiển thị lấy từ attempt/response đúng mức đã biết.
- Canvas cũ còn nguyên và có thể xem. Begin edit/rename/connect/delete/Undo/Redo hoặc replacement khác abort/invalidate Generate trước khi edit commit, kể cả interaction chưa tăng revision.
- Save/autosave/read-only export không tự invalidate Generate; nếu settlement tạo edit thật thì chính edit đó làm candidate cũ stale.
- `succeeded` chỉ sau final validation và atomic accept. Close drawer sau success không chuyển attempt thành cancelled hoặc hủy Document vừa accept.
- Late success/error/finally của A không được đổi loading/status/issues của B. Cleanup chỉ hủy controller/job của owner A, không gọi global cancellation làm dừng job B.

### 6.2. Abort và deadlines

- Cancel/Close, superseding operation, unmount hoặc total timeout phải abort HTTP client request, hủy measurement/layout job đang thuộc attempt và invalidate acceptance ticket. Kết thúc UI nhanh, không chờ provider trả response.
- Nối optional signal qua parser execution options → API request signal/deadline → DeepSeek `fetch`. Tái sử dụng seams của Step 5 nếu đã triển khai; giữ lời gọi parser cũ không truyền options hoạt động.
- Mặc định provider parse deadline 90 giây, generation attempt tổng 120 giây từ Begin sau settlement, layout worker giữ 10 giây theo Step 4. Settlement riêng được giới hạn 5 giây theo §5; không có khoảng chờ vô hạn nằm ngoài các budget. Một owner quản lý/tắt các timers; reason user-cancel và timeout được phân biệt.
- Abort là best effort đối với xử lý upstream; token/revision/epoch guards vẫn bắt buộc ở mọi acceptance boundary. Không hứa Cancel khiến provider hoàn tiền hoặc chắc chắn dừng compute. `abort()` hủy fetch/body consumption ở phía hỗ trợ signal. [MDN — AbortController.abort](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort).
- Không thêm automatic provider retry, backoff request loop hoặc chuyển sang mock/provider khác. Nếu upstream không quan sát được disconnect, deadline vẫn chặn result commit và kết thúc request khi runtime hỗ trợ.

### 6.3. Retry có nghĩa rõ

- `Retry generation` tạo attempt ID/ticket/controller mới; không dùng lại candidate đã lỗi hoặc đã cancel.
- Khi prompt/context/mode còn như last failed attempt, Retry dùng nội dung đang hiển thị đó và credential hiện tại nếu người dùng vừa sửa key. Khi đã đổi prompt/mode/context, UI chuyển sang Generate bình thường; không gửi lại prompt cũ ẩn phía sau.
- Người dùng được sửa nội dung sau failure/cancel, không bị reset về sample. Không tự retry do drawer reopen, render hoặc network reconnect.
- `Retry save` chỉ thử ghi **Document canonical mới nhất**, không gọi Generate hoặc khôi phục snapshot cũ của lần save lỗi.
- `Retry export` tạo export job mới từ snapshot hiện tại, không gọi provider/layout.

## 7. Autosave và trạng thái lưu

### 7.1. Một coordinator sở hữu mọi write

Giữ một bản lưu local tại `kora:diagram:v1`, tiếp tục dùng validator/storage adapter Step 2. Toolbar Save, Ctrl+S, post-Generate và autosave phải đi qua cùng coordinator; bỏ các direct save call cạnh tranh trong UI.

Autosave subscribe **canonical commits**, gồm move/rename/create/reconnect/delete, Auto Layout, Generate/Import/Clear replacement, Undo và Redo. Không subscribe draft keystrokes, pointer frames, selection, theme, toast, export progress hoặc pending candidate.

- Debounce 600 ms sau commit mới nhất; max-wait 3 giây khi có nhiều committed edits liên tiếp. Chỉ một timer đang chờ; flush lấy Document hiện tại, không dùng closure của snapshot đã cũ.
- Track `savedFingerprint` bằng serialization ổn định/content identity của toàn persisted Document, revision và epoch gắn với snapshot đã ghi. Không dùng `updatedAt` để kết luận saved.
- Manual Save/Retry save flush ngay sau settlement và cancel/coalesce timer trùng. Chỉ no-op khi current fingerprint khớp baseline **và** storage value vẫn được xác nhận trusted/unchanged, coordinator không paused/error. Sau external change hoặc read/quarantine failure, fingerprint trùng baseline cũ không đủ: explicit Save phải thực sự ghi current snapshot thành công để resolve trạng thái, không trả success bằng no-op.
- Với một write attempt, validate và serialize xong mới `setItem`; chỉ đánh dấu saved sau write thành công cho đúng current fingerprint. Startup/Load đọc lại baseline dùng trạng thái restored theo §7.3, không giả là vừa write. localStorage write hiện là synchronous, không cần giả tạo một async persistence queue.
- Save/autosave không dispatch command, không tăng revision, không thay metadata/updatedAt hoặc làm mất redo.
- Undo trước timer flush phải lưu snapshot sau Undo. Replacement commit supersede pending snapshot trước đó; Undo replacement lại lưu snapshot đã phục hồi.
- Generate/Import fail hoặc Cancel không xóa dirty autosave của diagram hiện tại đã được edit hợp lệ trước đó. Acceptance cancellation và persistence scheduling là hai trách nhiệm riêng.

**Thay đổi policy có chủ đích so với Step 2 §7:** Import thành công giờ trở thành committed edit được autosave sau debounce; không còn cam kết “Import không tự ghi localStorage”. Load đọc bản lưu tại thời điểm bấm rồi thay Document nếu hợp lệ; không flush dirty canvas trước Load làm ghi đè chính bản người dùng định mở. Generate chỉ persist sau accept và khi coordinator được phép write: trong quarantine/paused, Generate thành công vẫn không tự ghi đè key; explicit Save thành công hoặc Load hợp lệ thiết lập lại trusted baseline mới resume autosave. Bỏ direct post-Generate save cũ để không phá guard này. Trạng thái Saved luôn đợi bằng chứng storage phù hợp.

### 7.2. Startup, lỗi và overwrite guards

| Tình huống | Hành vi |
| --- | --- |
| Đang hydrate/restore | Không ghi initial empty Document; pending save không được chạy trước load result |
| Có Document hợp lệ | Reset một lần, establish saved baseline; không tạo history/save lại chỉ vì mount |
| Không có bản lưu | Mở prompt, chưa ghi gì; commit thực đầu tiên hoặc Manual Save mới có thể write |
| Bản lưu invalid | Giữ nguyên raw key; workspace an toàn, autosave paused; notice cho biết Save explicit sẽ thay bản lưu không đọc được |
| Startup read unavailable | Autosave paused vì chưa biết có bản lưu gì; Manual Save/Retry save là write explicit; có thể retry Load để thiết lập trusted baseline nếu đọc lại hợp lệ |
| Write/quota/access denied | Giữ diagram/history và value cũ; persistent Error + unsaved indicator, pause automatic writes tới Retry save/Save thành công |
| Đã paused nhưng tiếp tục edit/generate/import | Vẫn dùng diagram bình thường; dirty snapshot cập nhật, không tự ghi đè key đang được bảo vệ |

Manual Save trong trạng thái paused là hành động explicit ghi đè bản lưu bằng current Document đã validate; chỉ write thành công mới resolve pause qua đường này. Explicit Load đọc được Document hợp lệ cũng có thể thay current Document và thiết lập trusted baseline; invalid/unavailable Load không mở guard. Cho phép Export JSON để lấy bản sao khi storage lỗi. Không remove key trước write, không thử ghi document rỗng để xử lý quota và không tự xóa dữ liệu cũ.

Load action capture raw saved value trước khi timer save khác được flush; valid Load establishes baseline theo value đã đọc và supersede old pending timer. Invalid/unavailable Load không đổi Document/history, nhưng phải pause autosave để timer cũ không phá raw value vừa phát hiện lỗi. Import chọn file bị cancel trước khi có file không tạo replacement hoặc save.

Không cần merge nhiều tab. Nếu nhận storage event có value khác bản đã biết, pause automatic writes và hiển thị `Saved data changed in another tab`; cho Load bản đó hoặc Save current explicit. Có thể kiểm tra value trước flush để phát hiện khác biệt; không gọi localStorage là atomic compare-and-swap hoặc hứa xử lý được mọi simultaneous write race.

### 7.3. Status phải tồn tại đủ lâu để dùng

| State | UI và ý nghĩa |
| --- | --- |
| `loading` | Đang đọc bản lưu; chưa cho autosave |
| `new` | `Not saved yet`; chưa có bản lưu, không schedule initial-empty write |
| `clean` | `Saved locally` hoặc `Restored local copy`; current fingerprint khớp trusted baseline |
| `dirty` | `Unsaved changes`; timer chờ hoặc autosave đang paused |
| `saving` | Đang validate/serialize/write; không kéo dài giả spinner cho localStorage sync |
| `error` | `Could not save` + Retry save, giữ dirty; toast hết không xóa trạng thái này |
| `paused` | Nêu nguyên nhân cụ thể và Save/Load action phù hợp; không ghi là saved |

Chỉ hiển thị thời điểm last saved khi coordinator quan sát write thành công trong session; startup/Load không biết thời điểm write trước đó thì omit timestamp. Không lấy `updatedAt` hoặc thời điểm hydrate làm save time.

Persistence state và generation/export state độc lập. Generate thành công nhưng save fail phải báo diagram đã tạo, chưa lưu được; không rollback diagram hoặc hiện success “saved”. Toast của job cũ không được xóa persistent storage error/status mới.

Khi `visibilitychange` sang hidden hoặc `pagehide`, flush best effort **committed** snapshot nếu coordinator được phép write; không commit draft/preview hay bắt đầu request async mới. Không dựa riêng vào unload để chống mất dữ liệu; normal operation phải autosave trước đó. [MDN — visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event).

## 8. Errors, warnings và thao tác UI

Giữ structured `code`, stage và issues; error text ngắn, chỉ ra hành động tiếp theo. Giữ ngôn ngữ nhất quán trong các controls/copy được sửa, không mở một dự án i18n mới.

| Loại kết quả | Hành động hữu ích |
| --- | --- |
| Missing/invalid key | Mở credential settings; giữ draft; không yêu cầu người dùng thông thường sửa file code/env |
| Network/provider unavailable hoặc timeout | Retry generation explicit với prompt đang hiển thị; giữ diagram hiện tại |
| Invalid response/IR/Document | Cho đọc issues code/path/entity; sửa prompt hoặc Retry; không hiển thị raw response/stack |
| Stale vì người dùng đã edit/open diagram khác | `Generation cancelled because the diagram changed`; không báo là diagram mới đã tạo |
| Cancel người dùng | Trạng thái cancelled, có thể Generate lại; không trình bày như provider error |
| Asset/layout warnings nhưng Document hợp lệ | Diagram vẫn accept; warning panel có thể đọc/dismiss, không chỉ console |
| Storage error | Retry save/Export JSON; không đặt nút Retry generation làm giải pháp lưu dữ liệu |
| Export error/limit | Retry export hoặc chọn SVG/1× theo nguyên nhân; không đổi canvas để làm export vừa |

- Progress/status dùng live region phù hợp; alert chỉ khi có lỗi cần hành động, không đọc screen-reader mỗi pointer frame.
- Cancel/Retry/Export menu có accessible name, focus nhìn thấy và dùng keyboard được. Close drawer trả focus về Edit Prompt; export menu/format dialog không cướp focus sau khi job kết thúc nếu người dùng đã tiếp tục edit.
- Enter trong textarea tiếp tục xuống dòng; không tạo provider call bất ngờ. Ctrl/Meta+S có một owner, commit label theo §5, chặn browser Save Page; Undo/Delete trong input giữ native text behavior.
- API key/headers/raw exceptions không vào UI diagnostics/export/source. UI không tự chuyển Quick Test để che provider error.

Nếu giữ Quick Test, đổi thành demo fixture rõ ràng: một tập example cố định, prompt hiển thị tương ứng và kết quả được gắn `source.kind: "fixture"`. Không cho arbitrary text chạy canned fallback rồi trình bày là AI đã hiểu. Không ship cả eval corpus trong client; không cần xây parser demo mới.

## 9. Export contract và kiến trúc

### 9.1. Một snapshot, một đường render

```text
settle editor → clone canonical Document + revision/epoch + resolved theme
                                      ↓
                           validate + prepare ExportScene
                                      ↓
                        standalone native SVG serialization
                                ├──────────→ .svg
                                └→ decode → canvas → .png
```

- Export JSON giữ canonical Document/source và compatibility Step 2. SVG/PNG là hình của diagram hiện tại, không phải file có thể import lại thành Document.
- Export job có identity/controller/status riêng; không gọi `OperationCoordinator.begin` của replacement hoặc cancel Generate/Layout chỉ vì bấm Download.
- Sau settlement, export là read-only: không normalize Cloud, Auto Layout, cập nhật routes/dimensions, dispatch command, Save, Fit View hoặc đổi viewport.
- Freeze Document/theme sau settlement và trước await fonts/assets; tiếp tục dùng snapshot đó nếu người dùng edit, đổi theme hoặc Generate diagram mới trong lúc export. Không chắp geometry từ hai revisions.
- Một export job active; Cancel giải phóng resources, job mới supersede job cũ. Late decode/toBlob completion không được tải file hoặc đổi state job mới.
- Export **toàn diagram**, không chỉ DOM đang nhìn thấy. Pan/zoom, Fit View, devicePixelRatio và selection không thay geometry output.

`ExportScene` là derived value, không persisted và không trở thành graph thứ hai để edit. Chứa numeric boxes/text runs/paths/style/assets đã resolve; serializer không cần gọi AI, DOM canvas library state hoặc layout engine.

### 9.2. Dùng chung renderer contracts

- Reuse `resolveNodeDisplay`: canonical label có thể hiển thị shortName, custom label giữ text, subtitle theo cùng resolver; không xuất raw semantic label ở mọi nơi bất chấp canvas presentation.
- Extract shared edge geometry helper từ `AwsConnectionEdge`: cached polyline, smooth-step fallback, self-loop và label center/bounds. Canvas và export dùng cùng helper, current anchors/sides và precision.
- Cache chỉ dùng sau signature/usability/geometry check theo Step 4. Missing/stale/unusable cache dùng shared fallback; một warning cho biết đang xuất fallback, không âm thầm reroute hoặc lưu cache mới.
- Labels rỗng không xuất `+ Label` hoặc editor placeholder. Parallel/reciprocal/self-loop vẫn là entities riêng dù paths trùng nhau; giữ từng arrowhead/label tương ứng.
- Extract shared text-layout output gồm actual line strings, positions, width/height, font/weight/size/line-height/letter-spacing. Metrics hiện có line counts chưa đủ để tạo `<tspan>` đúng.
- Chốt cùng whitespace/wrap policy cho DOM renderer, measurement và SVG: CSS hiện `white-space: normal`, letter-spacing của labels/Cloud title cần được tính. Không thay semantic strings hoặc đo `.length` để đoán dòng.
- Dùng chung container registry và resolved visual profile: badges, border/dashes, fills/opacity, padding/title và thứ tự lớp. Ancestor container trước descendants; paths/bodies/labels theo cùng layer policy với canvas, không để fill che connectors ngoài ý muốn.
- Có một shared `resolveEffectiveNodeBox` cho React Flow wrapper, node body, anchors/signature và export scene. Hiện wrapper fallback 96×79 còn body/metrics có thể tính kích thước khác; refactor phải loại bất nhất này trước khi claim export parity.
- Giữ nguyên từng width/height đã lưu; chỉ resolve field thiếu bằng captured profile và text layout tại effective width. Không backfill vào Document. Nếu text vượt box đã lưu, giữ geometry, tính bounds phần text thực và báo overflow; không tự sửa bố cục.

Refactor chia sẻ rendering phải giữ Step 4 geometry/quality regression. Không viết một bộ sizing/routing/theme khác chỉ cho export.

### 9.3. Standalone SVG và resources

- Dùng native `<svg>`, `<g>`, `<path>`, `<rect>`, `<text>/<tspan>`, `<defs>/<use>` hoặc nested SVG của icons. Không dùng `foreignObject`, HTML screenshot hoặc bitmap toàn diagram nhúng vào SVG.
- Giữ official AWS icons/badges từ catalog local. Inline nội dung trusted assets; namespace mọi local ID và reference (`href`, `xlink:href`, `url(#...)`, styles) vì icon files có tên ID lặp. Không dùng semantic IDs trực tiếp làm XML IDs thiếu namespace/escaping.
- Unknown asset dùng đúng generic resolver/warning như canvas. Known asset/badge/font cần cho scene mà load/decode lỗi thì export fail, không bỏ icon/để ô trắng rồi báo thành công.
- Bundle font được phép redistribute, pin source/hash và giữ license trong repo; dùng font local nhất quán cho app/measurement/export. Font phải cover Vietnamese acceptance, được embed vào SVG. Không phụ thuộc Google font CSS/network khi mở file offline.
- Không hứa mọi emoji/CJK/glyph sẽ pixel-identical trên mọi máy. Khai báo font/fallback coverage; glyph chưa hỗ trợ phải có warning/failure cụ thể, không claim full-text fidelity khi thiếu glyph.
- Resolve paint values tại capture: light/dark `system` được chốt thành một theme cụ thể, không để CSS variables/media query/remote stylesheet quyết định lại sau khi tải file.
- Escape text/attributes; không có scripts, event handlers, untrusted markup hoặc external resource href. Các labels như `<script>`/`&`/quotes phải hiện đúng như text.
- SVG có `viewBox`, width/height và optional `<title>` từ diagram title. Không nhúng original prompt, credential, parser response hoặc UI diagnostics trong hidden metadata của SVG/PNG.

SVG file phải còn paths/text/vector icons thật và mở được offline trong các browser nghiệm thu. Tính portable của embedded fonts khi SVG được decode làm image phải được test thật, không suy ra từ XML hợp lệ.

## 10. Bounds, PNG và file download

### 10.1. Full-document bounds

Bounds là union của nodes, containers kể cả rỗng, visible title/header/text, toàn bộ path extrema, self-loop, arrowheads, edge-label rectangles và stroke/filter/shadow extents. Node hull đơn thuần không đủ. Thêm padding mặc định 24 logical px mỗi phía, giữ negative coordinates bằng viewBox/translate.

Kiểm tra finite sau các phép `x + width`, extrema/union và scale, không chỉ từng input. Không crop children kéo ngoài container, label nằm ngoài node hull hoặc path đi vòng xa. Export không sửa membership/positions để đưa chúng về trong parent.

- Pure empty Document không có node/container/edge: disable SVG/PNG, thông báo `Nothing to export`; JSON vẫn được phép.
- Container-only và graph không có edges vẫn export bình thường.
- Selection rings, hover fill, handles, connect/drag previews, inputs, grid, minimap và toolbar không nằm trong export scene.

Preflight phải chạy **trước DOM text measurement và scene/resource allocation**, với các budget V1: tối đa 5.000 entities, 100.000 route points tổng và 10.000 points/connection, 10.000 UTF-16 code units mỗi visible text field và 200.000 tổng, 10 MiB render-input UTF-8 payload. Source prompt/metadata không được render không nằm trong visible-text budget. Đếm/code-unit limits là resource guard, không phải phép đo glyph/line width; vượt thì từ chối export có lý do, không cắt label hoặc bỏ points. Các asset/font bytes được giới hạn tiếp khi load theo SVG byte budget.

Các vòng xử lý lớn phải có bounded batches/yield hoặc worker và check cancellation/deadline giữa batches; không đợi xong measurement/serialization mới kiểm tra limits. Timer không preempt được synchronous work đang chiếm main thread: timeout 30 giây ở §10.2 được quan sát qua các checkpoints/async boundaries, không phải lời hứa dừng mọi phép tính đồng bộ đúng millisecond.

### 10.2. PNG từ đúng SVG

- Decode SVG Blob đã tự chứa resources, vẽ lên canvas theo scale đã chọn, rồi `toBlob('image/png')`. Xử lý cả decode error, canvas security exception, null blob và encode failure; không tải blob rỗng. [MDN — HTMLCanvasElement.toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob).
- Chọn 1× hoặc 2× logical pixels, mặc định 2×; output pixel dimensions = ceil(scene width/height × scale). Không lấy devicePixelRatio ngoài option này.
- Background mặc định là màu canvas của theme đã capture, không có grid; tùy chọn transparent giữ alpha. Text/stroke vẫn theo theme đã chọn; preview options phải nói rõ transparent dùng màu của theme hiện tại.
- V1 caps: mỗi PNG side ≤ 8192 px, tổng ≤ 16.000.000 pixels; SVG serialized ≤ 25 MiB, scene ≤ 5.000 entities. Tính/kiểm tra trước allocate/decode; bytes/fonts/assets cũng nằm trong SVG limit. Các constants phải centralize và có boundary tests.
- Quá PNG limit thì từ chối có lý do, đề nghị 1× hoặc SVG nếu phù hợp; không tự giảm scale, crop hay re-layout. F9 lớn có thể hợp lệ nhưng không fit cap; graceful refusal là kết quả đúng.
- Export job timeout tổng 30 giây; font/asset/decode waits nằm trong budget. Cancel/timeout/supersede cleanup Blob URLs, image handlers/source và canvas; completion muộn không download.

Giới hạn trên là product budgets đã chọn cho Step 6, không phải tuyên bố universal browser limits. Nếu browser nghiệm thu cần giảm cap, cập nhật spec/constants/test evidence có chủ đích, không làm im lặng lúc export.

### 10.3. JSON và download semantics

- Export menu ghi rõ `JSON (editable backup)`, `SVG`, `PNG`; JSON chứa original prompt/source nếu có, SVG/PNG chỉ chứa diagram.
- Tên file từ title, bỏ ký tự path/control/Windows-invalid, trim dots/spaces, giới hạn 80 graphemes và fallback `architecture`; extension đúng format. Không dùng prompt/API data làm filename.
- Validate/encode xong mới tạo download. Resource URL phải sống đủ qua decode/hand-off và được revoke sau đó; không revoke trước khi consumer dùng xong.
- Success UI là `Download started`, không khẳng định hệ điều hành đã lưu file. Report browser phải xác nhận riêng file tải về mở/đọc được.
- Cùng snapshot/options/profile/assets cho cùng SVG geometry/content ổn định; không yêu cầu PNG bytes giống giữa encoders/browsers. Không nhúng export timestamp ngẫu nhiên làm mất determinism không cần thiết.

## 11. Automated acceptance

Tách pure workflow/scheduler/export tests khỏi browser tests. Dùng fake clocks, storage adapters, deferred transport/layout/font promises và scene fixtures; không gọi provider trong test thường.

| ID | Case | Kết quả bắt buộc |
| --- | --- | --- |
| U01 | V1 legacy không source; source hợp lệ/sai kiểu/timestamp | Legacy giữ field absence; extension round-trip; invalid bị từ chối không thay canvas/storage |
| U02 | Prompt Unicode/whitespace; Generate A success; sau đó edit | Source đúng submitted A, không đổi bởi draft/manual edits/save |
| U03 | Generate B fail/cancel/stale sau A | A/source/history/redo giữ nguyên; B draft còn trong session |
| U04 | Generate/Import/Clear, Undo/Redo replacement | Diagram/source/draft rebase đúng; ordinary edit Undo không reset draft |
| U05 | Close/reopen drawer; accept rồi close; unmount | Close Cancel pending request, giữ draft; close sau success không rollback/cancel success |
| U06 | A trả muộn sau B; late error/finally; đổi mode/key lúc attempt | Attempt snapshot bất biến, owner B không bị A thay state hoặc cancel job |
| U07 | User Cancel/provider timeout/layout timeout/measurement race | Abort/cleanup đúng owner, không commit/persist candidate; cancel khác error |
| U08 | Retry generation sau failure và sau sửa draft; Retry save/export | Đúng snapshot hiện tại; mỗi explicit click tối đa một request/job; save/export retry không gọi AI |
| U09 | 100 preview frames, typing/selection/theme vs một commit | Không autosave preview; commit schedule một debounce |
| U10 | Edit → Undo trước flush; edit → replacement → Undo | Flush latest canonical snapshot/source; không lưu late closure cũ |
| U11 | Dirty edit rồi Generate fail/cancel hoặc file picker cancel | Dirty save hợp lệ vẫn diễn ra; không bị operation cancellation xóa |
| U12 | Startup hydrate loaded/missing/invalid/unavailable; Generate khi paused | Không initial-empty/post-Generate overwrite; explicit Save write hoặc valid Load resolve đúng policy; không bịa last-saved time |
| U13 | Debounce/max-wait/Manual Save/no-op, double Ctrl+S handlers | Một scheduler/write path; no-op chỉ khi storage baseline còn trusted; không timestamp/history/redo mutation |
| U14 | Quota/access error, edit tiếp, Retry save; hidden/pagehide | Không loop writes/giả saved; retry latest; hidden chỉ flush committed nếu được phép |
| U15 | Load khi dirty timer còn chờ; invalid Load; valid Import | Read saved trước flush; preserve raw khi lỗi; Import autosave theo policy mới |
| U16 | External storage change A→B trước flush, rồi Save current A bằng fingerprint cũ | Pause/notice; explicit Save thực sự ghi A, không giả success no-op hoặc auto-merge/reload |
| U17 | Save/Export từ inline edit + IME + async fonts/late blur/never-resolving fonts | Settle đúng một lần và có deadline 5 giây; timeout dừng action, giữ draft; callback muộn không rename diagram mới |
| U18 | Demo fixture vs real mode; credential failures | Không canned fallback cho arbitrary prompt, provenance/messaging đúng, không credential leak |
| U19 | Snapshot edited/negative/container-only; legacy thiếu dimensions với long label/subtitle; saved-small-box overflow; empty graph | Shared wrapper/body/anchor/export effective boxes khớp, giữ dimensions đã lưu/field absence; full bounds; empty image refusal, JSON hợp lệ |
| U20 | Cache usable/missing/stale/invalid, mọi side và self/parallel/reciprocal | Shared paths/labels/anchors giống canvas; không persist cache/geometry mới |
| U21 | Long Vietnamese, custom/canonical labels/subtitle, whitespace/W/i | Shared line runs/profile đúng, không cắt text để vừa; semantic strings không đổi |
| U22 | SVG icons trùng IDs, nested headers, escaped labels, resolved theme | Entity groups đầy đủ, refs isolated, không foreignObject/scripts/external assets hoặc CSS variables |
| U23 | Bounds ngoài node hull, arrow/path curves, overflow dimensions, huge single label/route | Preflight từ chối trước DOM measurement/scene allocation; union/finite-after-arithmetic đúng, không crop/truncate |
| U24 | PNG 1×/2×, alpha/theme, decode/null blob/encode failure | Đúng dimensions/options; failure không tải file trắng hoặc giả success |
| U25 | Edit/theme/document replacement trong export; so với export mới/Cancel export/timeout/unmount | Edit/theme/replacement vẫn cho download captured snapshot; chỉ export job bị supersede/cancel/timeout/unmount mới không download/đổi state; cleanup resources |
| U26 | Source/content JSON vs SVG/PNG, filename invalid chars | JSON giữ provenance; hình không nhúng prompt/key; tên/extension an toàn |
| U27 | Export/save/layout error sau Undo | Không mất redo hoặc mutate Document vì read-only operation; settle edit thực được tính riêng |
| U28 | Nhiều lần export/save, huge text/route preflight, font/asset fail và cleanup | Có cancellation checkpoints, không leaks, không silent fallback cho known missing icon/font hoặc listener/timer trùng |

Tests phải assert Document before/after, full serialized value, revision/history behavior, call counts, owner IDs, path/label geometry và output scene IDs. Không gọi một test “export complete” chỉ vì có XML header hoặc node count bằng nhau.

## 12. Browser acceptance

Browser profile/origin riêng, không xóa bản lưu của người dùng. Viewport 1440×900, zoom browser 100%; kiểm tra light/dark và canvas zoom 50/100/150% cho flow và export independence. Ghi browser/version, source identity, fonts/profile, URL và options.

1. Generate B2 qua fake provider adapter được ghi rõ; kiểm tra original prompt và nguồn provider/fixture. Kéo ECS, rename node/container/edge, reconnect, Undo/Redo; chờ `Saved locally`.
2. Reload/đóng rồi mở lại: giữ edited semantics/positions/sides/routes và original prompt, không tự gọi AI/re-layout. History cũ không cần còn; thao tác mới vẫn edit/Undo được.
3. Nhập draft mới, Cancel khi parse/measure/layout chậm; thử A/B hoàn tất đảo thứ tự và edit giữa Generate. Không có late jump/status/save. Retry đúng text đang hiển thị.
4. Giả lập storage quota/access-denied/corrupt startup và external change; trạng thái lỗi không mất sau toast. Export JSON lấy backup, Retry save latest, reload kiểm tra value thực tế.
5. Import legacy/source-bearing JSON rồi Undo/Redo; bản legacy không hiển thị prompt từ diagram trước. Clear + Undo restore source. Không có draft/blur commit muộn.
6. Tải SVG/PNG từ B3-empty, F3 nested, F5 loops/parallel và F6 Unicode/long text. So current canvas bỏ interactive decoration với export scene, geometry/label positions trong sai số 1 logical px trên cùng font/browser/profile; ghi screenshot có thể review.
7. Mở SVG đã tải ở tab riêng khi offline, kiểm tra fonts/icons/badges/text/arrowheads; rasterize PNG offline và mở file thực tế. Kiểm tra header/dimensions, transparency và không clipping. Count XML không thay bằng chứng này.
8. Pan/zoom/selection rồi export lại: giữ full diagram, không grid/handles/toolbar. Đổi theme hoặc edit trong lúc PNG encode: file thuộc snapshot ban đầu, canonical state mới vẫn đúng.
9. F9/stress và fixture vượt limit: SVG hợp lệ trong budget hoặc refusal cụ thể; PNG không crop/downscale ngầm, UI vẫn dùng được. Cancel/repeated export không giữ Blob URLs/canvas bất thường.
10. Keyboard/focus/IME: Ctrl+S có một action, text Undo native, Cancel/Retry/export menu dùng được không cần chuột; status/error được đọc đúng mức.

Live provider smoke nếu có điều kiện dùng B2 một lần với request budget riêng; ghi đúng provider/model và không dùng Quick Test. Provider smoke không thay các failure-path tests hoặc quality measurement của Step 5.

Hiện build/browser bị chặn bởi SWC trong báo cáo Step 4. Khi triển khai phải kiểm tra lại một lần trên source cuối; nếu vẫn chặn thì lưu log và đánh browser/export fidelity `BLOCKED`, không tự đánh pass từ offline tests. Không lặp build vô hạn hoặc tuyên bố Step 6 nghiệm thu đầy đủ khi chưa mở được files/render thật.

## 13. Module và trình tự triển khai

```text
src/core/diagram/{types,schema,validator}.ts    # Optional source contract
src/core/workspace/
  generationSession.ts                       # Attempt ownership, abort/deadline/retry
  persistenceCoordinator.ts                  # Startup gate, scheduler/status, flush
  promptSession.ts                           # Draft vs original source, epoch rules
src/core/editor/interactionSettlement.ts      # Await commit/cancel before actions
src/core/rendering/
  connectionGeometry.ts                      # Shared cached/fallback path + label geometry
  textLayout.ts                              # Actual runs/positions, shared font/wrap rules
  visualProfile.ts                           # Resolved styles/paint order
src/core/export/
  scene.ts                                   # Derived immutable full-document scene
  bounds.ts                                  # Geometry/text/path/arrow extents + budgets
  svg.ts                                     # Native serialization, asset refs/escaping
  png.ts                                     # Decode/rasterize/encode, cleanup
  download.ts                                # File names, hand-off/results
src/core/ai/parser.interface.ts, providers/*   # Optional signal/deadline/test seams
src/app/api/parse-architecture/route.ts        # Request/deadline propagation
src/app/page.tsx, components/prompt/*
src/components/toolbar/*, footer/*, canvas/*   # Thin wiring, shared render contracts
public/fonts/*                               # Pinned local fonts + license
tests/fixtures/experience/*
scripts/test-workspace-experience.ts
scripts/test-diagram-export.ts
docs/experience/<run-id>/report.md
```

Có thể gom helper nhỏ, giữ existing architecture. Không thêm persistence/history layer song song hoặc cài screenshot/export library trước khi chứng minh native scene cần dependency đó. Cơ chế chia sẻ text/paths là refactor phục vụ fidelity, không đổi semantic graph/layout contract.

Thứ tự:

1. Chốt source compatibility, draft/replacement ownership và interaction settlement; test Undo/Redo/legacy trước.
2. Centralize storage writes/status, hydration/quarantine guards, debounce/flush/races; fake clocks/storage U01–U18.
3. Nối attempt cancel/deadline/progress/retry và safe errors; giữ token/revision guards, không auto retry provider.
4. Extract shared paths/text/style profile, local fonts/resources; chạy Step 4 geometry/routing/metrics regressions khi refactor.
5. Xây scene/bounds/native SVG rồi PNG/options/cleanup; U19–U28 và vector assertions.
6. Typecheck/build/regression source cuối; browser workflow và downloaded-file offline checks; sửa lỗi scope trước nghiệm thu.
7. Báo cáo ma trận U01–U28 và browser evidence; ghi compatibility/policy changes cùng blockers, không chỉ log tests pass.

Lệnh dự kiến từ `D:\Project\Kora`:

```powershell
.\node_modules\.bin\tsx.cmd scripts/test-workspace-experience.ts
.\node_modules\.bin\tsx.cmd scripts/test-diagram-export.ts
.\node_modules\.bin\tsx.cmd scripts/test-document-validation.ts
.\node_modules\.bin\tsx.cmd scripts/test-document-ingestion.ts
.\node_modules\.bin\tsx.cmd scripts/test-editor-commands.ts
.\node_modules\.bin\tsx.cmd scripts/test-editor-transactions.ts
.\node_modules\.bin\tsx.cmd scripts/test-layout-geometry.ts
.\node_modules\.bin\tsx.cmd scripts/test-layout-routing.ts
.\node_modules\.bin\tsx.cmd scripts/test-layout-worker.ts
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
npm.cmd run build
```

Hai scripts experience/export là deliverables cần tạo, chưa tồn tại. Package aliases test mặc định phải offline. Nếu `tsx`/npm bị policy/PATH chặn như run trước, dùng bundled runtime/TypeScript emission vào thư mục tạm và ghi command/exit code thật; không bỏ browser checks vì CLI tests pass. Chạy thêm parser/golden/baseline và React checklist nếu thay pipeline hoặc nhiều TSX components. Không gọi script provider live như một phần regression thường.

## 14. Evidence và nghiệm thu

```text
docs/experience/<run-id>/
  environment.json                 # Source identity/hash, runtimes/browser/font profile
  results.json                     # U01–U28 + browser cases, PASS/FAIL/BLOCKED/NOT_RUN
  logs/                            # Typecheck/build/unit/integration
  documents/                       # Before/after/reloaded, provenance/geometry checks
  exports/                         # Downloaded JSON/SVG/PNG + options/scene diagnostics
  screenshots/                     # Canvas/export/offline file render comparisons
  report.md
  issues.md
```

Run ID dùng thời điểm bắt đầu thực tế theo Asia/Saigon, không ghi đè run cũ. `NO_GIT` phải kèm hashes source liên quan; ghi rõ fake provider/captured IR/live call. Không lưu key/headers/raw provider transcript vào report/artifacts.

Báo cáo phải có compatibility source extension, policy Import/autosave thay Step 2, camera/draft session limits, request cancellation limitations, fonts/licenses/profile, export bounds/caps và kết quả mở file offline. Phân biệt read-only export với label commit do settlement; nếu export làm xuất hiện một command thì phải chỉ ra đó có phải rename hợp lệ hay mutation lỗi.

- [ ] Source optional được validate/round-trip; legacy không bị chèn prompt giả; Generate/Undo/Redo source–diagram atomic.
- [ ] Draft không đè provenance hoặc reset mỗi edit; Close/Restore/replacement có policy rõ và hoạt động đúng.
- [ ] Cancel/deadline/retry và owner guards ngăn stale commit/status; không auto provider retry/fallback.
- [ ] Một autosave coordinator, commit-only scheduling, status thật; startup invalid/unavailable không bị initial-empty overwrite.
- [ ] Save/Retry save giữ history/redo, failure giữ dữ liệu cũ; Import policy mới và external-change handling có tests.
- [ ] JSON giữ prompt nguồn và edits; SVG/PNG không nhúng prompt/credential hoặc UI decoration.
- [ ] Native SVG dùng shared text/paths/assets/profile, đầy đủ entities và bounds, tự chứa fonts/icons, mở được offline.
- [ ] PNG từ cùng SVG đúng scale/background/alpha; caps/failure/cancel cleanup được kiểm tra thật.
- [ ] U01–U28, typecheck/regressions và build có trạng thái/evidence trên source cuối; các phần bị chặn được nêu cụ thể.
- [ ] Browser chứng minh vòng Generate → edit → autosave → reopen → edit → export, gồm download/open-file fidelity; offline tests không thay nó.

Deliverables hiện có là source/tests/fonts và báo cáo `docs/experience/20261018-104520/`. Offline harness không xác nhận browser rendering hoặc file PNG thực tế; các mục bị chặn và chưa chạy được liệt kê trong báo cáo.
