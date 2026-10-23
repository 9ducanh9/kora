# Kora — Step 4: Chất lượng layout, routing và labels

Ngày soạn: 2026-10-17  
Trạng thái: Core và F1–F9 offline acceptance đã pass; browser/build acceptance còn chờ  
Thư mục dự án: `D:\Project\Kora`  
Tài liệu liên quan: [Kora V1](../../kora_initial_spec.md), mục 7, 13–15 và 20–22; [Step 1 — Baseline](./step-1-v1-baseline.md); [Step 2 — Validation](./step-2-document-validation.md); [Step 3 — Editor](./step-3-editor-transactions.md); [Step 4 implementation report](../layout/20261017-2104/report.md).

## 1. Mục tiêu

Generate và Auto Layout phải tạo diagram đọc được ngay: đủ thực thể, nested boundaries đúng, text nằm trong vùng được dành sẵn và connections có đường đi rõ ràng. Routing mà layout engine tính phải được dùng trên canvas, thay vì chỉ dùng vị trí nodes rồi vẽ lại connector theo một cách độc lập.

**Làm rõ phạm vi ngày 18/10/2026:** chính sách bố cục áp dụng chung cho toàn bộ Kora, cùng dùng trong Generate và Auto Layout. Engine chọn composition theo vai trò và topology của từng graph: web, nhiều backend, serverless, event/data pipeline hoặc compound graph lớn. LiveCap là một regression case; không dùng tên dự án, node ID hay dữ kiện triển khai riêng của LiveCap làm điều kiện áp dụng. Bằng chứng mở rộng: [Shared layout verification](../audits/20261018-shared-layout/verification.md).

Các kết quả bắt buộc:

1. Empty container, nested container và graph rỗng được xử lý đúng loại object.
2. Nodes/containers không chồng lấn sai; child nằm trong vùng content của parent sau full Auto Layout.
3. Node labels, subtitles, container headers và edge labels dùng kích thước thống nhất giữa layout và renderer.
4. Orthogonal routes bám đúng handles, tránh node bodies và container headers, có chỗ cho labels.
5. Self-loops, parallel/reciprocal connections và cross-container edges vẫn là các connections riêng, có thể chọn/sửa.
6. Auto Layout giữ semantics, explicit side choices và viewport; Undo phục hồi geometry/routes cũ bằng một bước.
7. Cùng prepared model, metrics và options cho cùng kết quả layout; lỗi hoặc kết quả cũ không làm hỏng diagram đang mở.

Không cam kết graph bất kỳ đều không có edge crossings. Không được dùng giới hạn đó để bỏ qua lỗi routing/overlap của bộ acceptance đã chốt.

## 2. Phạm vi và phụ thuộc

### Trong phạm vi

- Shared visual metrics, header sizing, deterministic ELK compound layout.
- Private IDs, explicit ports, chuyển tọa độ routes/labels về canvas.
- Routing audit, sửa route bằng các bước hữu hạn và bố trí label có kiểm tra collision.
- Route cache optional trong presentation, validation và invalidation theo editor commands.
- Candidate quality report, bounded retries, worker execution và stale-result guards.
- Regression fixtures, geometry assertions và visual/browser QA.

### Ngoài phạm vi

- Kiến trúc AWS do AI đề xuất, đổi parser/model hoặc tự chia scope thành nhiều diagram.
- Node pinning, partial layout, manual bend points, kéo label riêng, container resize UI.
- Tự reparent theo vị trí, thay đổi connections để làm hình đẹp hơn hoặc gộp các service có cùng icon.
- Đổi toàn bộ visual design, generated artwork, export SVG/PNG hoặc deployment.
- Tự sắp xếp lại vị trí nodes khi load hoặc sau mỗi thao tác kéo tay.

Khi triển khai phải xác minh Step 2/3 đã có trong code; các spec trước chưa phải bằng chứng tính năng đã hoàn thành. Hoàn tất validator, command/interaction và side-persistence contracts cần thiết trước khi nối layout mới. Giữ source và thay đổi ngoài phạm vi.

## 3. Hiện trạng và quyết định kỹ thuật

| Nguồn dưới `src/` | Hiện trạng đã đọc | Yêu cầu Step 4 |
| --- | --- | --- |
| `core/layout/elkCompoundLayout.ts` | Compound ELK layered, nhưng classify container bằng việc có children | Reverse map theo semantic kind, kể cả empty container |
| Cùng file | User IDs đi thẳng vào ELK, synthetic root cố định `root` | Namespace nội bộ cho mọi object và reverse map đầy đủ |
| Cùng file | Tạo edges không có measured labels/explicit ports; bỏ sections sau layout | Đưa ports/labels vào graph và lấy lại routes |
| Cùng file | Làm tròn container nhưng không làm tròn node; dùng fallback dimensions khi thiếu output | Một precision policy, lỗi output phải được phát hiện |
| `core/layout/nodeDimensions.ts` | Dự đoán 1–2 dòng bằng số ký tự | Đo text hoặc dùng shared metrics có bằng chứng DOM tương ứng |
| `components/canvas/canvas.css` | Text có wrapping/clamp riêng, width 96px; header dùng badge/title với layout riêng | Layout và CSS phải dùng cùng box model, không che thiếu chỗ bằng ellipsis trong acceptance |
| `components/canvas/AwsConnectionEdge.tsx` | Luôn dùng `getSmoothStepPath` và vị trí label suy ra từ path đó | Dùng route/label đã tính khi hợp lệ; fallback có policy rõ |
| `components/toolbar/CanvasToolbar.tsx` | Auto Layout có nhánh normalization và thay geometry dựa vào counts | Giữ acceptance/semantics contract Step 2–3 |

Giữ ELK.js làm engine bố trí compound graph trong bước này. Local package hiện có hỗ trợ layered, orthogonal edges, ports, labels, self-loops và parallel edges. Khả năng có trong library chưa chứng minh adapter Kora dùng đúng; kiểm tra bằng fixtures thực tế. Không nâng dependency để thay cho việc sửa adapter.

Tách trách nhiệm: **measure → build graph → layout → normalize coordinates → route/label audit → bounded repair → validate → atomic apply**. Renderer chỉ dựng objects từ geometry đã chốt hoặc fallback theo đúng current anchors.

## 4. Input/output và các invariant

### 4.1. Input của full layout

- Prepared Architecture Model hợp lệ khi Generate; Document semantic snapshot hợp lệ khi Auto Layout.
- Existing `presentation.connections` nếu có, để giữ side choices theo Step 3.
- Một visual-metrics snapshot, normalized options và routing profile/version.
- Operation token/revision, cancellation signal ở lớp orchestration; không nhét chúng vào semantics.

Core layout nhận các metrics bằng số, không tự đọc DOM/localStorage hoặc gọi provider. Browser measurement là bước chuẩn bị input; offline tests có metrics provider cố định.

### 4.2. Output

Kết quả gồm geometry nodes/containers, connection routes/label boxes và quality diagnostics. Generated Document dùng các kết quả này; Auto Layout ghép chúng vào snapshot hiện có.

Không thay node/edge/container IDs, labels, assets, membership, parent links, relationships, description, scope, title hoặc createdAt để làm layout đẹp hơn. Auto Layout giữ viewport, sourceSide/targetSide explicit và sự vắng mặt của các field side; updatedAt theo edit-command policy.

Tọa độ persisted là tọa độ tuyệt đối trên canvas. Không chuyển renderer sang relative-parent coordinates như một phần của Step 4.

### 4.3. Structural validity khác quality

- Thiếu entity/presentation, sai map, NaN/Infinity, dimensions không dương hoặc routes sai kiểu là lỗi cấu trúc: reject candidate trước commit.
- Sibling overlap, header collision, label collision, node-obstructed route là quality findings. Phải bằng 0 trên bộ acceptance full-layout bắt buộc.
- Diagram đã chỉnh tay vẫn có thể hợp lệ khi overlap hoặc kéo ra ngoài parent theo Step 2. Không dùng quality gate để từ chối Save/Import hoặc tự sửa geometry lúc load.
- Với input khác bộ acceptance, engine cố gắng trong budget rồi trả issues cụ thể nếu chưa đạt chất lượng. Không bỏ thực thể/label hoặc báo “layout sạch” khi vẫn còn findings.

## 5. Shared visual metrics

### 5.1. Font và phép đo

Không dùng `.length` để suy ra text width hoặc line count. Tiếng Việt, combining marks, emoji, `WWW`, `iii` và chuỗi không có dấu cách phải được kiểm tra.

Browser chuẩn bị measurement sau khi font dùng cho operation đã sẵn sàng. Chụp font family thực tế, weights, font sizes, line heights, padding và wrapped text bounds thành metrics snapshot. Nếu font ngoài chưa tải được trong thời hạn chuẩn bị, chọn fallback thực tế và dùng nhất quán cho cả đo lẫn render của operation; báo profile đã dùng trong diagnostics.

Renderer phải dùng cùng font/box profile với phép đo, không để font tải muộn âm thầm đổi wrapping rồi làm sai geometry đã tính. Có thể dùng font local để ổn định; không cần dịch vụ measurement hoặc provider AI. Determinism được chứng minh với **cùng metrics/profile**, không hứa pixel giống giữa các máy dùng font khác nhau.

Đo DOM ở scale 1, không lấy kích thước đã nhân canvas zoom làm input. Fit View/theme/pan/zoom không được tự kích hoạt một lần layout hoặc sửa Document.

### 5.2. Node bodies

- Giữ icon AWS chính thức 48×48, semantic/custom labels và subtitles từ resolver hiện có.
- Chọn width nhỏ nhất trong `[96, 128, 160, 192]` canvas units để primary label không quá 3 dòng và subtitle không quá 2 dòng. Nếu vẫn vượt, dùng width 192 và tăng height đủ cho toàn text.
- Dùng wrapping có thể ngắt long token; không đổi text semantic hoặc loại Unicode để ép vừa box.
- Định nghĩa font, line height, border, padding, icon gap và subtitle gap trong shared profile, dùng lại trong CSS và measurement. Không tiếp tục cộng chiều cao theo heuristic độc lập với CSS.
- Đưa dimensions đã đo vào ELK trước layout; renderer tôn trọng dimensions đã chốt. Không thay height sau khi ELK đã tính containment rồi bỏ qua tác động.
- Labels của bộ acceptance phải đọc được đầy đủ ở canvas zoom 100%, không bị clamp/ellipsis che nội dung. Full text vẫn có accessible name/tooltip để tra cứu ở zoom thấp.

Node rename của Step 3 dùng cùng sizing contract mới; cập nhật kích thước trong chính rename transaction. Không chạy full layout sau rename.

### 5.3. Container headers và empty size

Header là một rectangle được dành chỗ rõ ràng, gồm border/insets, badge, gap và title block. Đo title với wrap width tối đa 240 canvas units, lưu cả width và height thực tế sau wrapping, tăng header height theo text cần dùng; không dùng pre-wrap text width để tính minWidth hoặc để title tràn qua child content.

```text
minWidth ≥ left inset + badge width + gap + measured title width + right inset
contentTop = header bottom + content gap
containerHeight ≥ contentTop + child/content height + bottom padding
```

Badge không có thì không giữ gap như có badge. Top padding hiệu lực lấy giá trị lớn hơn giữa cấu hình registry hiện có và header/contentTop đã đo. Side/bottom padding dùng registry chung.

Container rỗng có minimum 180×100, nhưng phải lớn hơn nếu header/padding không vừa. Nó vẫn là container trong `presentation.containers`, không dựng node giả làm child để tránh lỗi classify.

Load bản cũ giữ tọa độ và dimensions đã lưu. Nếu text/profile hiện tại không vừa, giữ Document và báo cần Auto Layout; không tự giãn container hoặc ghi geometry mới chỉ vì mount. Legacy node dimensions thiếu có thể dùng resolver để render như Step 2, nhưng không tự persist defaults.

## 6. Deterministic compound layout

### 6.1. IDs và ordering

- Tạo private IDs riêng cho synthetic root, nodes, containers, edges, ports và labels; giữ forward/reverse maps với kind rõ ràng.
- Sort theo semantic ID bằng thứ tự ổn định không phụ thuộc locale trước khi cấp internal IDs. Node và edge có thể cùng chuỗi ID theo Step 2; internal namespaces vẫn phải khác nhau.
- User ID `root`, `cloud-aws`, `e0` hoặc giống tên internal khác không được làm mất object.
- Chỉ classify output qua reverse map; không suy từ children array, prefix của user ID hoặc sự tồn tại width/height.
- Synthetic root không lọt vào Document. Mỗi semantic entity xuất hiện đúng một lần trong đúng map; empty/root-only graphs vẫn có kết quả hợp lệ.

Step 4 thay tạm thời policy collision ở Step 2 bằng cách cấp private ELK IDs. Khi Generate cần tạo system Cloud mà `cloud-aws` đã được entity khác chiếm, chọn suffix đầu tiên còn trống (`cloud-aws-2`, `cloud-aws-3`, …) theo node/container namespace. Không đổi ID của entity đã có; không thêm Cloud trong Auto Layout hoặc Load.

### 6.2. ELK options

Dùng compound layered với `INCLUDE_CHILDREN`, orthogonal routing và fixed port positions theo shared anchors. Chọn một nonzero random seed cố định; normalize mọi spacing/direction options trước khi build graph.

Hai spacing profiles hữu hạn:

| Profile | Node spacing | Layer spacing | Container child spacing |
| --- | ---: | ---: | ---: |
| Base | 60 | 100 | 36 |
| Spacious | 90 | 140 | 54 |

Hỗ trợ hướng RIGHT và DOWN. Hướng graph không tự đổi explicit sides hoặc default right-source/left-target của Step 3. Đường nối có thể cần thêm bend khi sides khác hướng chính; không sửa side choice để giảm số bends.

Labels và dimensions phải có trước ELK. Model-order hints có thể dùng, nhưng không thay phép kiểm chứng lặp lại và hoán vị input. Không tạo internal IDs bằng thời gian/random.

### 6.3. Tọa độ và containment

Tính absolute origin của mọi container theo hierarchy trả về. Cộng offsets đúng một lần cho children. Giữ số thực hữu hạn; không làm tròn container riêng rồi để leaf dùng số chưa làm tròn. Dimensions đo trước ELK có thể ceil theo shared metric policy; không tự ceil/round output sau layout mà không kiểm tra lại bounds.

Missing coordinates/dimensions của entity thật là `LAYOUT_OUTPUT_INVALID`, không che bằng `|| 200`, `|| 79` hoặc tọa độ default. Riêng synthetic root origin có thể quy ước `(0,0)` nếu engine không trả x/y cho root.

Kiểm tra child rectangle đầy đủ nằm trong content bounds của direct parent và toàn ancestor chain, có header/padding. Kiểm tra nonoverlap giữa direct sibling rectangles; ancestor/descendant overlap là containment có chủ đích.

## 7. Ports, routes và chuyển tọa độ edge

### 7.1. Một anchor resolver

Dùng chung công thức anchor cho React Flow handles, ELK ports, endpoint validation và fallback renderer. Source và target trên cùng side có hit targets riêng theo Step 3; không giả định cả hai đều là midpoint trùng nhau.

Input anchor gồm kind/side/role, node dimensions và handle offset profile. Endpoint ngoài/giữa border phải khớp vị trí handle render trong sai số 1 canvas unit. Port escape stub tối thiểu 12 units hướng ra ngoài node; không đi xuyên node body để tới corridor.

Persisted sides là giá trị của Step 3, không phải internal port ID. Không thêm visual fields vào Architecture IR.

### 7.2. Chuẩn hóa ELK sections

- Traverse edges ở root lẫn nested containers, map về semantic connection và phát hiện duplicate/missing output.
- Resolve hệ tọa độ của edge theo owner/container mà ELK trả. Bản library hiện tại có thể trả runtime field `container` ngoài phần type declaration; đọc có kiểm tra và xác minh bằng fixture của version đang cài. Khi field vắng mặt, dùng tree owner theo contract đã kiểm chứng.
- Cộng owner absolute origin cho section start/bend/end points và label boxes; không cộng origin của source node.
- Không ghép sections theo thứ tự array. Dùng references/connectivity để tìm đường liên tục source → target, đảo section nếu cần và bỏ điểm nối trùng.
- Disconnected, branching hoặc ambiguous sections không được biến thành một polyline có đoạn nhảy. Ghi route finding và đưa vào bounded repair.
- Sau chuyển đổi, route là ordered polyline tuyệt đối, có start/end khớp anchors, segments ngang/dọc, hữu hạn và có chiều dài hữu ích. Không persist ELK objects hoặc SVG path strings.

### 7.3. Obstacle policy

Routing profile V1 dùng clearance 8, label clearance 4 và lane gap 12 canvas units. Sai số hình học trong audit tối đa 1 unit; không dùng sai số để che việc đi xuyên obstacle.

| Obstacle/region | Quy tắc |
| --- | --- |
| Node bodies | Tránh toàn rectangle, trừ aperture/stub của chính endpoint |
| Container header band | Tránh, kể cả container chứa endpoint |
| Container chứa cả hai endpoints | Route nằm trong content region của common ancestor cần thiết |
| Container chỉ chứa một endpoint | Cho phép ra/vào qua boundary side/bottom hợp lệ; không cắt qua header |
| Container không chứa endpoint nào | Tránh cả interior; không xuyên qua một subnet/group không liên quan |
| Ancestor chain | Không coi toàn bộ ancestor như solid obstacle, vì sẽ chặn chính edge nội bộ |

Boundary crossing đúng membership là hợp lệ; khác với route đâm vào header hoặc vào một container không liên quan. Arrowhead/stroke không được che node/label khác, trừ phần chạm endpoint của chính edge.

### 7.4. Bounded route repair

Ưu tiên sections ELK đã normalize nếu pass audit. Nếu không, thử sửa route trên **geometry đã tính**, giữ anchors/sides:

- Dùng rectilinear corridor/visibility graph từ obstacle edges cộng clearance, port escape points và các boundary portals hợp lệ.
- Tìm đường theo chi phí ưu tiên tránh blocking collision, rồi chiều dài/bends/crossings; tie-break ổn định theo coordinates và connection ID.
- Không dịch nguyên polyline để tách lanes vì sẽ kéo endpoint rời handle.
- Không thay vị trí nodes trong bước route repair. Nếu vẫn có quality findings, thử full layout bằng Spacious profile rồi route/label lại.

Tối đa hai full-layout candidates (Base/Spacious), không vòng retry vô hạn. Route search có state budget 20.000 states mỗi connection; vượt budget phải trả finding thay vì treo UI. Chọn candidate ít blocking findings nhất, rồi ít label collisions, rồi crossings/bends/length; tie-break ưu tiên Base. Không giấu candidate bị chọn có findings.

Nếu cả hai candidates cấu trúc sai thì operation fail. Nếu còn chất lượng chưa đạt trên input ngoài acceptance suite nhưng cấu trúc hợp lệ, có thể hiển thị cùng warning/entity IDs; không bỏ edge/label hoặc tuyên bố layout đạt chuẩn. Bộ acceptance bắt buộc phải hết blocking findings để nghiệm thu.

### 7.5. Self-loop, parallel và reciprocal edges

- Self-loop có đường ngoài node, không co thành điểm; cùng source/target side vẫn phải có loop nhìn thấy và chọn được.
- Các edges cùng cặp endpoints được cấp lanes theo thứ tự ID ổn định; giữ anchors, chỉ tách phần corridor giữa, có thể dùng chung đoạn stub ngắn.
- Reciprocal edges giữ hướng arrow riêng, không vẽ như một edge hai chiều nếu semantics là hai connections.
- Không bật merge/dedup làm mất semantic edge. Giữ connection selector của Step 3 cho trường hợp cần phân biệt paths trùng.

## 8. Edge label placement

Đo label với shared font profile, max width 200 units, wrapping tăng height đủ toàn text và padding thống nhất. Semantic label không bị rút ngắn. Đưa width/height vào ELK; normalized label output là rectangle top-left `(x,y,width,height)`.

Nếu vị trí ELK không hợp lệ, thử tập vị trí hữu hạn trên các segments đủ dài: midpoint, 1/3, 2/3, sau đó offset hai phía với clearance. Thứ tự xét segments/offsets và connections cố định theo ID.

- Tránh node bodies, container headers, interiors của container không liên quan tới endpoints, label khác và non-owner edge segments; label box phải tuân thủ cùng membership regions như route ở mục 7.3.
- Owner segment có thể đi dưới label chip như renderer hiện tại; không tính đó là collision chặn. Label vẫn phải chỉ rõ connection tương ứng.
- Label của edge nội bộ common ancestor phải ở content region; không đặt ra ngoài boundary hoặc chồng lên header để lấy khoảng trống giả.
- Empty label không có persisted label rectangle. Selected `+ Label` hoặc input editing là UI overlay, không làm đổi routing cache mỗi lần hover/select.
- Không tìm được chỗ thì giữ full semantic text có thể xem/sửa, dùng vị trí fallback có finding `LABEL_PLACEMENT_UNRESOLVED`; không âm thầm bỏ label.

## 9. Presentation extension và route cache

Mở rộng `ConnectionPresentation` của Step 3, giữ nguyên side fields:

```ts
interface Point { x: number; y: number }
interface Rect extends Point { width: number; height: number }

interface ConnectionRoute {
  version: '1.0';
  inputSignature: string;
  points: Point[];
  label?: Rect;
}

interface ConnectionPresentation {
  sourceSide?: PortSide;
  targetSide?: PortSide;
  route?: ConnectionRoute;
}
```

Route cache là output có thể dựng lại từ semantics, boxes, sides và metrics; không phải semantic graph thứ hai. Không có manual bend points trong bước này.

### 9.1. Validation và signature

- `route` optional; schema hỗ trợ thêm field này có chủ đích, giữ strict với field lạ khác.
- Version đúng, signature là SHA-256 hex, points có ít nhất hai phần tử hữu hạn, label rect nếu có hữu hạn và dimensions dương. Orphan connection entry vẫn là error theo Step 3.
- Signature tính từ canonical UTF-8 JSON của **toàn routing input**: node/container boxes, hierarchy/header bounds, endpoint IDs/effective sides, tất cả connection IDs/labels, metrics text/header/label đã đo, actual font family/weights/sizes/line heights/wrapping/padding và routing/anchor profile version. Clearance/stub/lane constants phải có trong payload hoặc được khóa bởi version xác định; không chỉ hash tên profile danh nghĩa. Sort keys/IDs ổn định.
- Dùng global geometry/input signature vì một obstacle không phải endpoint cũng có thể làm route cũ sai. Không chỉ so sánh source/target positions.
- Schema validation là pure, không đo DOM. Lớp chuẩn bị renderer kiểm tra signature với metrics hiện tại, anchors và route audit trước khi dùng cache.
- Cache đúng kiểu nhưng stale hoặc không còn khớp anchors/geometry bị bỏ qua khi render với issue `ROUTE_CACHE_STALE`/`ROUTE_CACHE_UNUSABLE`; không làm mất Document hợp lệ. Signature chỉ là cache key, không thay geometric checks.
- Cache muốn được dùng phải có label rectangle nếu semantic label không rỗng, và không có rectangle cho empty label. Cache đúng shape nhưng thiếu/thừa placement theo text hiện tại là unusable; dùng fallback vẫn hiển thị full label, không âm thầm làm mất text. Pure schema không suy ra validity của cache chỉ từ optional `label` field.
- Malformed cache, ví dụ NaN hoặc sai required fields, là lỗi schema như các presentation fields khác.

Giữ version Document `"1.0"`, storage key và compatibility một chiều như extension Step 3. V1 cũ không có routes vẫn load được, không tự chèn routes/defaults khi read/save. Client strict cũ có thể từ chối file mới có `route`; ghi rõ trong report.

### 9.2. Renderer và lifecycle

| Trạng thái/operation | Hành vi |
| --- | --- |
| Generate / full Auto Layout thành công | Commit boxes và route/label cache hợp lệ trong cùng một command/replacement |
| Load/Import có cache hợp lệ | Render cache; không chạy layout hay đổi Document |
| Load/Import thiếu cache hoặc stale | Dùng current-anchor fallback và warning phù hợp; không đổi node positions, tự ghi storage hoặc chạy ELK để reflow |
| Drag/nudge/connect preview | Cache không áp dụng cho preview khác geometry; vẽ fallback từ current preview anchors |
| Cancel preview | Trở về cached routes ban đầu, không sửa Document |
| Edit thực làm đổi geometry/text/topology | Invalidate routes trong chính edit command theo mục 9.3 |
| Select/hover/theme/pan/zoom | Không invalidate và không thêm history |
| Undo/Redo | Phục hồi geometry và route-cache presence/values của before/after snapshot; không chạy ELK để tính lại history |

Fallback dùng shared anchors, path attached và self-loop tối thiểu. Nó không được giả danh route đã tránh obstacles/đạt quality gate. Hiện một trạng thái gọn nếu cần Auto Layout để tối ưu lại, không spam toast cho từng edge trong mỗi frame.

Step 4 tối ưu toàn cục sau Generate/Auto Layout. Sau kéo tay, tính đúng attachment và bỏ stale routes là bắt buộc; tự tối ưu mọi obstacle trong mỗi pointer frame nằm ngoài phạm vi.

### 9.3. Invalidation nguyên tử với edits

Move/nudge node hoặc subtree, rename node/container/edge, add/reconnect/delete connection và cascade deletion đều xóa **mọi cached `route`** trong cùng edit command. Giữ side choices và semantic identity; chỉ dọn entry/map trở nên rỗng do thao tác gỡ route, giữ các entry/map `{}` đã có sẵn và không bị ảnh hưởng. Bảo toàn before snapshot để Undo phục hồi đúng optional-field absence. Riêng connection bị xóa phải mất entry tương ứng dù entry đó đã rỗng từ trước.

Không tạo command thứ hai để “refresh routes”. No-op label/drag/reconnect không được xóa cache hoặc mất redo. Delete phải loại cả entry của connection bị xóa. Auto Layout mới có quyền thêm lại route caches bằng operation rõ ràng của người dùng.

## 10. Quality gate và diagnostics

Quality report phải có code, severity, entity IDs và geometry liên quan, tối thiểu:

- Missing/wrong presentation kind, invalid geometry và anchor mismatch.
- Parent-content containment, sibling/node overlap, header intrusion.
- Route-node/header/unrelated-container collision, disconnected route.
- Label-node/header/unrelated-container/label/non-owner-edge collision.
- Remaining edge crossings, bends, route length và unresolved lane/label placement.
- Text clipping và renderer-vs-metrics size mismatch từ browser QA.

Metrics crossing/bends/length là để so sánh candidates; crossing hợp lệ không bị gọi thành semantic error. Trên các fixtures có nghiệm không crossing đã chỉ định, vẫn phải kiểm tra kết quả tương ứng.

Report ghi raw/normalized/rendered evidence riêng, không gọi counts từ Document là browser render thành công. Warnings phải đến UI qua structured issues Step 2, có thể đọc lại theo entity, không chỉ console.

Không đặt quality rules này vào validator Save/Import để từ chối manual-overlap Documents. Candidate full-layout được audit riêng; structural Document validator tiếp tục bảo vệ tính toàn vẹn.

## 11. Execution budget, history và cancellation

Browser full layout chạy trong Worker, gồm ELK, coordinate normalization, route search/repair, label placement và quality audit; measurement ở main thread với batch DOM reads. Dùng assets/module local của ELK, không tải runtime engine từ CDN. Test phải chứng minh worker được dùng, không suy từ Promise rằng tính toán đã ra khỏi main thread.

Operation có deadline 10 giây sau measurement và tối đa hai candidates; timeout/cancel dừng worker/job hoặc bỏ kết quả một cách kiểm soát. UI còn phản hồi được để người dùng hủy/thao tác. Đây là guard chống treo, không phải tuyên bố mọi graph đều layout xong trong 10 giây.

- Dùng token/revision Step 2 sau measurement, worker result, repair và trước commit/status/finally cleanup.
- Gesture mới Step 3 làm result cũ stale trước cả khi drag commit.
- Auto Layout tạo đúng một command chứa geometry nodes/containers và route-cache changes, giữ raw side fields, viewport và semantics.
- Nếu candidate không có effective change thì không thêm history/timestamp; không dùng timestamp/signature phát sinh ngẫu nhiên để tạo khác biệt giả.
- Failure, timeout, cancellation hoặc superseded result giữ diagram/history/storage cũ. Generate thành công nhưng Save thất bại vẫn theo policy Step 2.

## 12. Bộ fixtures và test bắt buộc

### 12.1. Fixture suite

| Nhóm | Nội dung bắt buộc |
| --- | --- |
| F1 | B1, B2 và B3 của Step 1; giữ expected semantic graphs |
| F2 | B3-empty; graph rỗng; container-only; nhiều container rỗng lồng nhau |
| F3 | Cloud → Region → VPC → hai AZ → public/private subnets, edges trong/cắt qua các tầng; external users ở ngoài Cloud |
| F4 | Branch/merge DAG, disconnected components, backward/cyclic edges hợp lệ |
| F5 | Self-loop khác side/cùng side, ba parallel edges cùng endpoints, reciprocal pair, explicit non-default sides |
| F6 | Long labels/subtitles/headers, tiếng Việt dựng sẵn và combining marks, emoji, WWW/iii, long token; labels tới 120 ký tự |
| F7 | User IDs root/cloud-aws/e0, node và edge cùng ID; nested edge sections có owner offsets khác nhau |
| F8 | ServiceGremlin golden đang có; lấy counts từ fixture thực, không dùng comments/ước lượng làm expected counts |
| F9 | Stress có seed: 100 leaf nodes, 20 containers, depth tối đa 5, 150 connections; báo latency/budget/findings, không gọi nó là bằng chứng mọi graph phức tạp đều sạch |

F1–F8 là bộ acceptance full-layout: structural/containment/overlap và blocking route/label collisions phải bằng 0 cho các graphs được thiết kế có chỗ bố trí hợp lệ. Không giảm fixtures hoặc bỏ edge khó để đạt gate. F9 đo budget và graceful degradation; vẫn không được mất entities, crash hoặc commit output cấu trúc sai.

Fixtures độc lập có raw ELK sections và fixed metrics để kiểm tra adapter/geometry math; chúng không thay thế test tích hợp gọi ELK thật. Determinism so sánh trên cùng prepared model/metrics; không suy ra chất lượng parser hoặc tính deterministic của normalization upstream.

### 12.2. Unit/integration matrix

| ID | Case | Điều kiện pass |
| --- | --- | --- |
| L01 | Empty/root-only/container-only/nested empty | Đúng kind/key parity; không dummy node hoặc fallback dimensions |
| L02 | Reserved-looking user IDs, same node/edge ID | Private mapping đúng, không collision/drop |
| L03 | Generate cần Cloud khi cloud-aws đã bị chiếm | First-free suffix ổn định, giữ mọi original IDs; Auto Layout không tạo Cloud |
| L04 | Hai lần chạy và hoán vị arrays/record order của cùng prepared graph | Geometry/routes/labels tương đương trong sai số; loại timestamps khỏi so sánh |
| L05 | RIGHT/DOWN với default và explicit sides | Layout đúng hướng, anchors và raw side fields không đổi |
| L06 | Header/Unicode/long token và shared sizing | Đủ text bounds, empty min size/header padding đúng |
| L07 | Nested offsets, âm/thập phân, full child bounds | Absolute math đúng; không independent rounding gây tràn |
| L08 | Missing/NaN output từ fake ELK | Reject candidate, không che bằng geometry defaults |
| L09 | Sections đảo/trộn, nhiều owner levels, runtime container field | Một source→target polyline liên tục, cộng origin đúng một lần |
| L10 | Disconnected/branched/duplicate sections | Finding + bounded repair; không vẽ đoạn nhảy |
| L11 | Role-specific handles khác vị trí | React Flow/ELK/fallback cùng anchors trong 1 unit |
| L12 | Internal/cross-boundary/unrelated-container routes | Đúng obstacle/portal/header rules, không coi ancestor là solid obstacle |
| L13 | Parallel/reciprocal/self-loop | Không mất edges, loop nhìn thấy, lanes/labels phân biệt trên fixtures |
| L14 | Label ELK collision và deterministic finite candidates | Nhận diện/sửa vị trí đúng, không che node/header/label khác hoặc lấn unrelated container |
| L15 | No valid label/route trong search budget | Bounded findings, không retry vô hạn hoặc drop label/edge |
| L16 | Route schema valid/invalid/sparse/absent; missing/extra cached label theo semantic text | Validator/cache usability đúng contract; label không biến mất, legacy round trip không materialize defaults |
| L17 | Signature đổi do obstacle không phải endpoint hoặc metrics đổi | Không dùng stale route dù endpoint positions giữ nguyên |
| L18 | Manual preview/cancel/no-op | Preview attached; cancel/no-op giữ cache/history nguyên trạng |
| L19 | Move/rename/add/reconnect/delete thực | Cache invalidation cùng edit, giữ sides; một Undo phục hồi geometry/cache |
| L20 | Full Auto Layout, Undo/Redo/no-op | Một command, restore routes/boxes, giữ semantic/viewport/side absence |
| L21 | Save/Load/Export/Import với route cache | Giữ cache hợp lệ; cache stale ignored khi render, không reflow saved geometry |
| L22 | Worker timeout/cancel/new gesture/new replacement | Không stale commit/status overwrite; history/storage cũ giữ nguyên |
| L23 | F1–F8 actual ELK + quality audit | Zero blocking findings, đủ entities/labels |
| L24 | F9 stress và DOM metrics parity | Budget/quality được ghi; UI không treo, không output cấu trúc sai |

Tests phải assert coordinates/rectangle/segments/entity IDs cụ thể và exit nonzero khi fail. Negative tests chủ động chèn overlap hoặc đổi owner offset để chứng minh auditor phát hiện lỗi; test tên “non-overlap” không được chỉ kiểm tra x/y có tồn tại.

### 12.3. Browser acceptance

Browser profile/origin riêng, viewport 1440×900, browser zoom 100%. Kiểm tra light/dark và canvas zoom 50/100/150%; font/profile và source identity được ghi.

1. Generate Quick Test B2 rồi Auto Layout; đủ graph, labels và boundaries, không mất khả năng edit.
2. B3-empty, F3 và ServiceGremlin: Fit View để xem tổng thể, zoom 100% kiểm tra text/header/boundaries. Không dùng Fit View quá nhỏ làm bằng chứng text đọc được.
3. F5: paths/arrowheads đúng handles và hướng, parallel labels phân biệt; chọn từng edge bằng selector Step 3.
4. F6: kiểm tra DOM bounds thực tế với metrics và text clipping. Tải font chậm/failure không gây silent geometry rewrite hoặc font-wrap lệch sau operation.
5. Kéo một obstacle không phải endpoint vào đường edge: cache cũ không còn dùng; connector vẫn attached bằng fallback và có trạng thái cần Auto Layout. Cancel drag trả đúng route cũ.
6. Rename label dài, reconnect side-only, cascade delete: một Undo phục hồi nội dung/geometry/cache. Chạy Auto Layout để tối ưu lại rồi Undo/Redo.
7. Save/reload/import Document có cache; giữ node positions và side choices. Legacy/no-cache hoặc stale-cache Document không tự di chuyển nodes.
8. Làm chậm layout worker rồi drag/open diagram khác/hủy: result cũ không đè thao tác mới. Giả lập timeout và error, canvas/history cũ còn nguyên.

Lưu JSON trước/sau, normalized polylines, quality findings và screenshots/clip có viewport/zoom rõ. DOM measurement/capture mới chứng minh render đúng; `renderedCounts` không thay bằng chứng này.

## 13. Module và trình tự thực hiện

```text
src/core/layout/
  visualMetrics.ts                  # Shared profile, pure size contracts
  measureVisuals.ts                  # Browser adapter; offline inject metrics
  elkGraphAdapter.ts                # Private IDs, compound graph, ports/labels
  elkCompoundLayout.ts              # Layout orchestration / compatible entry
  normalizeElkOutput.ts             # Absolute boxes, sections, labels
  anchors.ts                        # Một anchor contract cho mọi adapter
  routeRepair.ts                    # Bounded rectilinear search/lane handling
  labelPlacement.ts                 # Finite placement candidates
  qualityAudit.ts                   # Geometry/route/label findings
  routeCache.ts                     # Signature, usability, invalidation helpers
  layout.worker.ts                  # Local worker, budget/cancel
src/core/diagram/{types,schema,validator}.ts
src/core/commands/commands.ts        # Atomic route invalidation/layout apply
src/core/architecture/prepareModel.ts
src/components/canvas/*             # Honor measured boxes/routes/label rects
src/components/toolbar/CanvasToolbar.tsx
src/core/pipeline/generationPipeline.ts
tests/fixtures/layout/*
scripts/test-layout-geometry.ts
scripts/test-layout-routing.ts
```

Có thể gom helpers nhỏ; đây là trách nhiệm, không phải yêu cầu thêm abstraction/file rỗng. Không thêm graph/layout engine mới khi ELK hiện có và postprocessing đã đủ.

Thứ tự:

1. Xác nhận code Step 2–3, baseline và output/layout issues; giữ bằng chứng trước khi sửa.
2. Chốt visual metrics/anchor contracts, route schema và validators; test legacy compatibility.
3. Sửa private IDs, empty-container classification, dimensions và coordinate normalization.
4. Nối explicit ports/labels/sections; viết auditor trước khi claim routing pass.
5. Thêm bounded repair, lane allocation và label placement; chạy F1–F8 cả RIGHT/DOWN.
6. Nối route renderer, command invalidation, history và stale guards; kiểm tra Save/Load.
7. Nối Worker/budgets, stress F9 và browser QA; báo kết quả trên source cuối.

Verification từ `D:\Project\Kora`:

```powershell
.\node_modules\.bin\tsx.cmd scripts/test-layout-geometry.ts
.\node_modules\.bin\tsx.cmd scripts/test-layout-routing.ts
.\node_modules\.bin\tsx.cmd scripts/test-editor-commands.ts
.\node_modules\.bin\tsx.cmd scripts/test-editor-transactions.ts
.\node_modules\.bin\tsx.cmd scripts/test-document-validation.ts
.\node_modules\.bin\tsx.cmd scripts/test-document-ingestion.ts
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
npm.cmd run build
npm.cmd run test:golden
.\node_modules\.bin\tsx.cmd scripts/test-containers.ts
.\node_modules\.bin\tsx.cmd scripts/test-compact-nodes.ts
```

Các scripts Step 2–3 là phụ thuộc dự kiến, phải xác minh tồn tại. Cập nhật V17 của Step 2: collision `root`/`cloud-aws` được xử lý có kiểm soát nay phải pass, giữ original IDs; output layout sai vẫn phải reject. V04 vẫn từ chối dictionary keys `__proto__`/`constructor`/`prototype`; private IDs không bỏ qua quy tắc validation đó. Cập nhật assertions compact-node cũ nếu sizing contract thay đổi có chủ đích; không bỏ assertions để làm xanh. Chạy baseline/parser regression offline theo Step 1, lint nếu đã cấu hình và React checklist sau khi sửa nhiều TSX components. Không cần provider có phí để nghiệm thu layout.

Deliverables khi thực hiện: source, geometry fixtures/auditor/tests, worker assets cần thiết và `docs/layout/<run-id>/report.md` gồm profile, determinism/quality/performance, route-cache compatibility và browser evidence. Spec này chưa triển khai hoặc tạo báo cáo kết quả đó.

## 14. Điều kiện nghiệm thu

- [x] Full layout bảo toàn semantic graph và xử lý đúng empty/container-only/nested graphs trong offline fixtures.
- [x] Private IDs loại collision; absolute coordinates và parent content bounds được kiểm tra bằng offline fixtures/auditor.
- [ ] Shared metrics và actual DOM khớp, Unicode/header/label trong acceptance không bị clipping.
- [x] ELK ports/sections/label geometry được dùng thật; routes đúng anchors, continuous và orthogonal trong routing fixtures.
- [x] F1–F8 đạt zero blocking node/header/container/label collisions, đủ entities và text trong offline acceptance theo RIGHT/DOWN.
- [ ] Parallel/self/reciprocal edges giữ riêng và thao tác được; không hứa mọi graph đều planar.
- [x] Route cache được validate/signature-check; stale cache không được render như hợp lệ.
- [x] Manual edits invalidate trong cùng command; offline tests cover preview/cancel, no-op, route-cache restoration and history behavior.
- [x] Auto Layout một command, giữ semantics/viewport/side choices và phục hồi routes khi Undo/Redo.
- [ ] Worker/cancel/timeout/stale results có bằng chứng; F9 không treo hoặc làm mất dữ liệu.
- [x] Legacy Save/Load/Import không reflow; extension compatibility và font/profile limits ghi rõ.
- [ ] L01–L24, browser acceptance, typecheck/build và regression có bằng chứng trên source cuối.

**Kết quả mong đợi:** Generate/Auto Layout tạo diagram có bố cục, đường nối và text nhất quán; sau chỉnh tay, connector vẫn bám đúng và không dùng lại geometry đã lỗi thời.
