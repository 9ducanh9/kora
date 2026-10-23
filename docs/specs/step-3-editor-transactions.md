# Kora — Step 3: Hoàn thiện editor và undo/redo

Ngày soạn: 2026-10-17  
Trạng thái: Core command/transaction behavior đã triển khai; targeted offline tests và typecheck pass. Full E01–E28, browser acceptance và build còn chờ. Xem [báo cáo Step 3](../editor/20261017-2109/report.md).  
Thư mục dự án: `D:\Project\Kora`  
Tài liệu liên quan: [Kora V1](../../kora_initial_spec.md), mục 12–19 và 22; [Step 1 — Baseline](./step-1-v1-baseline.md); [Step 2 — Document và validation](./step-2-document-validation.md).

## 1. Mục tiêu

Sau Generate hoặc Import, người dùng có thể sửa diagram như một tài liệu thực: chọn, di chuyển, đổi nhãn, nối lại và xóa các đối tượng. Canvas, Document, history và bản Save phải phản ánh cùng một kết quả.

Các hành vi bắt buộc:

1. Chọn một hoặc nhiều node, container, connection một cách ổn định.
2. Kéo nhiều node hoặc container cùng toàn bộ cây con mà không làm lệch tương quan vị trí.
3. Đổi nhãn node/container/connection đúng đối tượng, mỗi lần xác nhận chỉ tạo một edit.
4. Tạo connection, reconnect từng đầu và giữ phía nối khi lưu/mở lại.
5. Xóa selection gồm nhiều loại đối tượng bằng một thao tác; không còn dangling references.
6. Undo/Redo theo thao tác của người dùng, không theo từng pointer update.
7. Escape, thao tác bị hủy, no-op và callback đến muộn không làm thay Document hoặc mất redo.

Step 3 hoàn thành khi các hành vi trên được chứng minh bằng tests và browser, không chỉ có handlers trong source.

## 2. Phạm vi và phụ thuộc

### Trong phạm vi

- Session selection, interaction preview và adapter Document → React Flow.
- Drag một node, nhiều node, container/subtree và dịch chuyển bằng phím mũi tên.
- Inline label editing, connection handles, create/reconnect và atomic deletion.
- Command contracts, no-op detection, candidate validation và history tối đa 50 entries.
- Phần mở rộng presentation cần thiết để lưu phía nối.
- Tích hợp với validation, stale-operation guards, Save/Load/Export/Import của Step 2.

### Ngoài phạm vi

- Resize, tự giãn container, tự reparent khi thả node, group/ungroup hoặc membership editor.
- Palette thêm service bằng tay, copy/paste, duplicate, alignment tools và context menu đầy đủ.
- Tối ưu layout, obstacle routing, khoảng cách giữa parallel edges hoặc label placement; đây là Step 4.
- Thay semantics từ AI, cải thiện parser hoặc triển khai collaboration.
- Autosave mọi edit, history sau reload và đồng bộ viewport vào Document.

Khi triển khai phải kiểm tra Step 2 đã có trong code chưa. Có spec không có nghĩa đã triển khai. Không bỏ validation/stale guards để làm riêng editor; thiếu phụ thuộc thì triển khai hoặc hoàn tất phần phụ thuộc cần thiết trước và báo rõ phạm vi. Tái sử dụng fixtures/báo cáo Step 1 nếu đã có.

## 3. Hiện trạng đã đọc từ source

Các path dưới đây nằm dưới `src/`; đây là dữ kiện thiết kế spec, chưa phải kết quả kiểm tra browser:

| Nguồn | Hiện trạng | Thay đổi cần có |
| --- | --- | --- |
| `components/canvas/KoraCanvas.tsx` | Nodes/edges derive từ Document, chưa có luồng controlled changes/selection rõ ràng | Một chủ sở hữu session selection và preview |
| `KoraCanvas.tsx` | Drag handlers chỉ lưu một `node.id` | Một transaction chứa toàn bộ movement set |
| `core/commands/commands.ts` | Move chỉ sửa `presentation.nodes` | Move được cả nodes và containers trong cùng command |
| Canvas + commands | Container rename dùng command chỉ tìm `semantic.nodes`; delete chưa xử lý containers | Commands có target kind và kế hoạch subtree rõ ràng |
| `KoraCanvas.tsx` | Node/edge delete dispatch ở hai callback riêng | Một đường delete selection, một history entry |
| Canvas + `IRConnection` | Create/reconnect chưa lưu handle side; Document chưa có edge presentation | Lưu side ở presentation, giữ IR semantic |
| `AwsServiceNode.tsx` | Input bắt đầu từ short display label | Bắt đầu edit từ raw semantic label, tránh đổi text khi chỉ mở rồi blur |
| Ba label components | Enter và blur có thể cùng gọi commit, chưa có IME/session guard | Edit session chỉ được kết thúc một lần |
| `commandEngine.ts` | Dispatch vẫn push history khi command trả Document không đổi | No-op không truncate redo hoặc tăng revision |
| `canvas.css` | Container dùng pointer-events/layering riêng; source/target handles cùng vị trí | Kiểm tra hit targets và khả năng thao tác thật trên browser |

Local type declarations của `@xyflow/react` có `onNodesChange`, `onEdgesChange`, node drag với danh sách dragged nodes, selection drag và combined delete callbacks. Khi thực hiện phải dùng API của version đang cài; không giả định callback drag-cancel mà thư viện chưa cung cấp.

## 4. State và source of truth

Giữ tọa độ trong `DiagramDocument` là **tọa độ tuyệt đối trên canvas**. `containerId` và `parentId` là membership semantic. Không gắn thêm React Flow `parentId` rồi dùng lại tọa độ tuyệt đối như tọa độ tương đối.

Tách ba phần có trách nhiệm rõ ràng:

| State | Nội dung | Có Save/history không? |
| --- | --- | --- |
| Document canonical | Semantics, geometry đã commit, metadata | Có |
| Editor session | Selected IDs, focus, active edit/gesture, hover | Không |
| Interaction preview | Vị trí/draft/connection candidate của thao tác chưa kết thúc | Không |

React Flow nodes/edges được dựng từ Document cộng session/preview. Không giữ một bản semantic graph thứ hai có thể tự thay đổi độc lập.

- `onNodesChange`/`onEdgesChange` phải phân loại selection, measurement, position và remove intents. Không áp dụng mọi change trực tiếp lên Document hoặc dispatch cho từng event.
- DOM measurement và dragging flags là dữ liệu renderer; không tự ghi đè semantic hoặc geometry canonical do measurement callback.
- Preview không được biến mất khi theme, toast hoặc toolbar render lại; callback không được đọc snapshot React cũ thay cho transaction đang sở hữu gesture.
- Selection tồn tại trong session, được truyền qua `selected` cho controlled nodes/edges. Các field `selected` cũ trong presentation vẫn được chấp nhận theo Step 2 nhưng không điều khiển selection của phiên mới; không tự strip chúng khi load/export.
- Sau replacement/reset, hủy preview/edit sessions và xóa selection. Sau delete, loại IDs không còn tồn tại; Undo phục hồi entities nhưng không tự chọn lại toàn subtree.

## 5. Selection, hit targets và keyboard ownership

### 5.1. Hành vi chọn đối tượng

- Click node/icon hoặc container header chưa selected: chọn riêng đối tượng đó. Pointer-down trên một thành viên đã selected giữ nguyên multi-selection để có thể kéo cả nhóm; chỉ thu selection về một đối tượng khi kết thúc plain click mà không drag.
- Ctrl/Meta + click: thêm/bỏ đối tượng trong selection hiện tại.
- Click connection path hoặc label: chọn connection; Ctrl/Meta + click dùng cùng quy tắc cộng/bỏ.
- Click pane trống: bỏ selection. Kéo pane bằng chuột trái vẫn pan như hiện tại.
- Shift + kéo từ pane trống: marquee chọn các **service/external/generic nodes có toàn bộ bounding box nằm trong vùng chọn**. Không tự chọn enclosing containers hoặc edges từ marquee; chúng có thể được chọn bằng click/header.
- Shift marquee thay selection cũ bằng kết quả marquee. Không thêm quy tắc modifier kết hợp khác trong V1.

Trước Begin drag trên đối tượng chưa selected, resolve effective selection đồng bộ rồi mới snapshot movement set; không chờ React state selection cập nhật ở render sau.

Không bật đồng thời unmodified marquee và pan-on-left-drag rồi kỳ vọng cả hai cùng hoạt động. Container lớn không được vô tình được chọn chỉ vì vùng marquee nằm trong VPC/AWS Cloud.

Container chỉ bắt đầu drag từ header; interior để tương tác với child hoặc pane. Chọn/drag container không đưa background của nó lên che descendants. Giữ layering ổn định khi selected; tắt cơ chế auto-elevation nếu cần để đạt điều này.

### 5.2. Shortcut ownership

- Canvas focus: Delete/Backspace xóa selection; Ctrl/Meta+Z Undo; Ctrl/Meta+Shift+Z và Ctrl/Meta+Y Redo; Ctrl/Meta+S Save theo Step 2.
- Khi input/textarea/select/contenteditable hoặc editor có quyền sở hữu keyboard: text selection, xóa chữ, Ctrl/Meta+A và text Undo/Redo thuộc input, không chạy canvas commands.
- Không chặn shortcut đã được control/dialog xử lý; kiểm tra `defaultPrevented`, composition và focus thực tế.
- Ctrl/Meta+S trong label input là ngoại lệ dành cho Save: settle draft theo mục 11, gọi Save workspace và ngăn browser Save Page. Text Undo/Redo và Delete vẫn thuộc input. Không áp dụng ngoại lệ này cho dialog/control khác đã sở hữu và xử lý phím.
- Input dùng `nodrag`, `nopan` và chặn event phù hợp để gõ chữ không kéo node hoặc pan canvas.
- Toolbar thao tác trực tiếp theo mục 11, không dựa vào focus đang ở một node cũ.

Giữ node/edge focus nhìn thấy được và accessible names cho các nút. Không tắt toàn bộ keyboard accessibility chỉ để tránh native movement ngoài history.

## 6. Di chuyển và gesture transaction

### 6.1. Movement set

Từ Document và selection lúc bắt đầu gesture:

1. Selected leaf node được đưa vào movement set.
2. Selected container được đưa vào cùng mọi descendant containers theo `parentId`.
3. Đưa vào mọi node có `containerId` thuộc tập containers trên, kể cả node đang được vẽ ngoài boundary sau manual edit.
4. Union/deduplicate theo kind và ID. Parent cùng child đã được chọn chỉ làm child di chuyển **một lần**.
5. Selected edges không có geometry riêng để kéo trong bước này; chúng bám theo endpoints.

Movement dựa trên membership, không dựa vào containment hình học. Kéo subnet không kéo VPC cha hoặc subnet bên cạnh. Kéo leaf ra ngoài parent không đổi membership và không resize container.

### 6.2. Bắt đầu → preview → commit

```text
Begin: snapshot revision, token, movement set, tọa độ ban đầu, anchor
Update: tính một delta chung, dựng preview từ snapshot ban đầu
End: validate candidate + freshness → một MoveElementsCommand
Cancel/no-op: bỏ preview → không command
```

- Node-origin drag và selection-overlay drag dùng cùng controller. Nếu React Flow phát các callback chồng nhau, gesture token bảo đảm một start/commit duy nhất.
- Mọi vị trí preview = vị trí ban đầu + cùng một delta. Không cộng dồn delta theo từng frame; không cộng lại delta từ positions đã được thư viện di chuyển.
- Giữ nguyên dimensions, membership, labels, assets, metadata semantic và geometry của entities ngoài movement set.
- Edges phải bám theo node trong lúc preview, không chỉ sau khi thả chuột.
- Khi kết thúc, kiểm tra revision/token và sự tồn tại/kind của toàn movement set; sai thì từ chối toàn bộ, không áp dụng một phần.
- Validate candidate một lần trước commit; không validate toàn graph trong mỗi pointer move.

### 6.3. Snap và tọa độ

Anchor là đối tượng bắt đầu drag, kể cả khi nó là descendant của container cũng đang selected. Với selection-overlay drag, anchor là node/container được chọn trực tiếp có ID đầu tiên theo thứ tự Unicode code point ổn định; không lấy một descendant chỉ xuất hiện do expansion. Snap on: đưa anchor cuối về lưới 20 canvas units, dùng delta đó cho toàn movement set:

```text
delta = roundToGrid(anchorStart + rawDelta, 20) - anchorStart
newPosition[id] = startPosition[id] + delta
```

Không snap riêng từng child; offsets thập phân/off-grid giữa các entities phải được giữ. Tránh áp dụng lần nữa cơ chế rounding/snap của renderer lên từng node. Snap off giữ tọa độ hữu hạn dạng số thực, không `Math.round` từng vị trí.

Pointer-down không làm object nhảy về lưới. Gesture chưa vượt drag threshold của UI, hoặc thả đúng vị trí ban đầu với raw delta bằng 0, được coi là no-op. Khi drag thực sự kết thúc ở geometry đã commit ban đầu thì cũng không tạo command.

Drag threshold tính bằng screen pixels; delta và snap tính bằng canvas units sau chuyển đổi theo zoom. Tùy chọn snap được chụp tại Begin, thay toggle trong lúc gesture chỉ ảnh hưởng gesture sau.

### 6.4. Keyboard movement

Arrow keys khi canvas có selection dùng cùng movement set và command như drag. Snap on dịch 20 canvas units mỗi bước; snap off dịch 1 unit. Đây là delta chung, không ép riêng từng entity về lưới.

Một lần giữ phím với key repeat là một gesture: update preview theo từng keydown, commit một lần khi các arrow keys đã nhả. Không chọn text hoặc scroll trang khi gesture này đang sở hữu phím. Không để React Flow nudge thêm lần nữa ngoài controller.

Không áp dụng cho selected edges nếu không có selected node/container. No-op/cancel giữ redo như pointer drag.

### 6.5. Hủy và interrupt

Escape ngoài IME, window blur, document hidden, unmount hoặc canonical revision đổi từ operation khác phải hủy preview. Không chỉ cleanup trong drag-stop: thư viện có thể kết thúc interaction mà không gọi callback đó. Mọi late update/stop sau cancel phải bị bỏ theo token.

Begin drag/nudge/label/connect/reconnect phải vô hiệu hóa async replacement đang chờ theo Step 2 trước khi có command. Một Generate/Auto Layout cũ không được thắng chỉ vì người dùng đang kéo nhưng chưa drop.

## 7. Label editing

Áp dụng chung cho node, container và connection:

1. Double-click label mở một edit session, draft bắt đầu từ **raw semantic text**, không từ shortName hiển thị.
2. Mỗi session có target kind/ID, initial text, revision và trạng thái active/committed/cancelled. Một thời điểm chỉ có một editor.
3. Enter xác nhận một lần; blur xác nhận một lần. Enter rồi blur chỉ tạo một command.
4. Escape hủy, trả label ban đầu; blur sau Escape không được commit draft đã hủy.
5. IME composition không dùng Enter để commit hoặc Escape để hủy editor khi đang chọn chữ. Kiểm tra cả composition events và trạng thái keyboard phù hợp.
6. Node/container text rỗng hoặc chỉ whitespace bị từ chối: giữ giá trị cũ, kết thúc session với notice ngắn, không command. Connection được phép xóa label về chuỗi rỗng.
7. Text hợp lệ được giữ nguyên, không tự trim nội dung có ý nghĩa. Draft không đổi là no-op. Với edge, absent label và empty label được coi tương đương cho no-op khi người dùng chưa sửa text.
8. Khi opening editor mới, settle editor trước theo blur policy rồi lấy revision mới. External replacement/deletion/Undo/Redo hủy editor cũ; không để blur từ component cũ đổi Document mới.

Container rename sửa `semantic.containers`; node rename sửa `semantic.nodes`; edge rename sửa `semantic.connections`. Dùng typed target, không tìm cùng một ID ở nhiều map rồi sửa đối tượng đầu tiên thấy được.

Node rename giữ assetId, subtitle, membership và x/y. Nếu kích thước hiển thị thay đổi, dùng shared node-dimension resolver và cập nhật width/height trong cùng rename command để Document và renderer nhất quán; Undo phục hồi presentation cũ, kể cả field trước đó chưa có. Container rename không tự resize boundary. Không tự chạy ELK sau rename.

## 8. Connection attachment và phần mở rộng presentation

### 8.1. Quyết định schema

Phía nối là geometry, không thêm vào `IRConnection` hoặc prompt của AI. Mở rộng Document V1 theo hướng optional:

```ts
type PortSide = 'top' | 'right' | 'bottom' | 'left';

interface ConnectionPresentation {
  sourceSide?: PortSide;
  targetSide?: PortSide;
}

// Bổ sung vào DiagramDocument.presentation:
connections?: Record<string, ConnectionPresentation>;
```

- Đây là bổ sung có chủ đích cho tập structural fields được hỗ trợ trong Step 2; cập nhật schema/validator cùng lúc. Các field lạ khác vẫn bị từ chối.
- Map optional và sparse, không yêu cầu key parity như presentation của nodes/containers. Key nếu có phải trỏ đến semantic connection tồn tại; enum/field types phải hợp lệ, `null` hoặc orphan entry là error.
- Không có sourceSide thì render từ `right-source`; không có targetSide thì dùng `left-target`. Thiếu map/field không được tự materialize defaults khi load/save.
- Map side sang named handle của React Flow chỉ trong adapter, ví dụ `right → right-source` hoặc `right-target`. Document không phụ thuộc type/handle ID nội bộ của thư viện.
- Giữ `version: "1.0"` và storage key hiện có vì đây là extension optional. Bản mới đọc được V1 cũ; client Step 2 có strict schema cũ có thể từ chối file mới chứa field này. Không tuyên bố tương thích hai chiều.
- Auto Layout giữ map side choices hiện tại; Generate có thể không tạo map. Save/Load/Export/Import và replacement giữ đúng map, kể cả sự vắng mặt của optional fields.

### 8.2. Create connection

- Chỉ node hiện có được làm endpoint, gồm AWS/external/actor/generic; container không có connection handles trong V1.
- Dùng source/target roles rõ ràng, tương ứng ConnectionMode.Strict. Cả tám named handles của node phải thao tác được bằng hit target riêng; source và target cùng phía không được đè nhau đến mức một role không thể chọn.
- Handles chỉ nổi rõ khi hover, selected hoặc connection operation; target hợp lệ phải nhìn thấy và nhận pointer khi đang nối.
- Gesture thành công tạo đúng một ID unique, giữ nguyên qua Redo. Dùng UUID hoặc allocator kiểm tra collision; không dùng riêng Date.now hoặc endpoints làm ID.
- Lưu source/target cùng hai side được chọn trong một command. Label mặc định rỗng, relationship mặc định `request` như hiện tại.
- Cho phép parallel connections và self-loops theo Step 2. Không dùng helper có hành vi deduplicate endpoints để âm thầm bỏ edge thứ hai.
- Drop lên pane/container/handle sai role hoặc endpoint đã mất: hủy gesture, không tạo edge/command và không mất redo.

### 8.3. Reconnect

Khi selected edge, người dùng kéo được đầu source hoặc target. Reconnect thành công thay endpoint và side tương ứng **nguyên tử**, giữ ID, label, relationship, description và đầu còn lại.

- Có thể đổi side trên cùng node mà không đổi node ID; đây là edit nếu effective side đổi.
- Reconnect về đúng endpoints/effective sides cũ là no-op; không thêm field defaults chỉ để tạo khác biệt giả.
- Drop ra vùng không hợp lệ hoặc Escape giữ edge cũ, không xóa edge.
- Preview và kết quả commit đều dùng đúng selected handles; endpoints không nhảy về top handle sau rerender.
- Undo phục hồi semantic endpoint và presentation cũ, gồm field/map absence. Redo dùng lại kết quả đã chốt.

Basic renderer phải vẽ được edge/self-loop hợp lệ để chọn/sửa; nếu cần, thêm đường self-loop tối thiểu khi generic path bị co thành đường không nhìn thấy. Không mở rộng thành thuật toán tối ưu routing hoặc tách parallel edges trong Step 3.

### 8.4. Chọn các parallel edges trùng đường

Parallel edges có thể trùng path hoàn toàn. Khi selected edge có các edges cùng endpoints và effective sides, hiển thị một nút nhỏ như `2 connections` mở danh sách chọn từng connection, dùng label và số thứ tự để phân biệt. Chọn một item đổi selected edge ID, không đổi graph/history. Control phải dùng được bằng keyboard.

Mỗi edge trong nhóm phải có thể rename/reconnect/delete độc lập; không để edge trên cùng che vĩnh viễn các edge còn lại. Đây là cơ chế selection tối thiểu, không yêu cầu tách đường nối hoặc thêm sidebar quản lý graph.

## 9. Xóa selection và subtree

Chọn **cascade delete** cho container: xóa boundary cùng toàn bộ descendants theo membership. Thao tác này có Undo, không cần confirmation dialog bổ sung.

Một delete plan được tính từ Document canonical tại lúc chạy:

1. Lấy selected containers và toàn bộ descendant containers.
2. Lấy selected nodes cùng mọi node thuộc các containers trên.
3. Lấy selected connections và mọi connection có source/target trong tập node bị xóa.
4. Deduplicate tất cả tập; giữ nguyên external nodes hoặc nodes ngoài subtree dù chúng có edge đi vào subtree.
5. Xóa semantic records, node/container presentation và connection-presentation entries tương ứng bằng một command.

Áp dụng cả container rỗng, AWS Cloud có `origin: "system"`, selection gồm ancestor+descendant và xóa toàn bộ diagram. Không chạy normalization để tái tạo Cloud sau delete. Nếu chỉ còn external nodes hoặc diagram rỗng, kết quả vẫn hợp lệ.

Undo phục hồi đủ entities, properties, hierarchy, geometry và edge side choices, không chạy layout. Lưu snapshots đủ để phục hồi optional-field absence; Redo xóa đúng cùng tập entities đã chốt.

### Một đường xử lý delete

Tắt native `deleteKeyCode` của React Flow, dùng Delete/Backspace do workspace/editor sở hữu và một nút `Delete selection` rõ ràng trên toolbar. Giữ `Clear canvas` là thao tác riêng theo replacement contract của Step 2.

Không dispatch từ hai callback `onNodesDelete` và `onEdgesDelete` cho cùng gesture. Không dùng payload renderer làm nguồn authoritative để tính cascade. Các removal events nội bộ nếu còn phát phải được xử lý như intent của cùng operation, không tạo delete command thứ hai.

Sau delete, lọc session selection. Không có selection thì Delete là no-op; khi đang gõ label thì Delete/Backspace chỉ xóa chữ.

## 10. Command engine và history

Commands phải tạo candidate mới mà không mutate input; dữ liệu before/after của một command đã commit không được bị sửa bởi gesture sau.

| Operation | Nội dung command |
| --- | --- |
| Move | Before/after positions của cả node và container trong movement set |
| Rename | Typed target, before/after label; node geometry nếu thay đổi |
| Add connection | Semantic connection và side presentation, ID được cấp một lần |
| Reconnect | Before/after endpoint và side, giữ các properties khác |
| Delete selection | Snapshot toàn bộ entities/presentation bị xóa |
| Auto Layout / replacement | Giữ contract Step 2 |

Engine/command factory phải phát hiện effective no-op **trước** timestamp update. No-op trả lại Document hiện tại và không push history, truncate redo, notify, tăng revision hoặc đổi updatedAt.

Với edit thực:

1. Tạo candidate từ Document hiện tại.
2. Validate candidate theo Step 2, gồm connection-presentation extension.
3. Chỉ khi hợp lệ mới đổi Document, history cursor và revision.
4. Notify đúng một lần cho một commit. Preview đi qua editor state, không notify canonical engine từng frame.

Áp dụng thứ tự tương tự cho Undo/Redo; validation hoặc command failure không được dịch cursor trước rồi bỏ lại state sai. Commands redo phải tái sử dụng ID, target set và final positions đã chốt, không tính lại dựa vào selection mới.

- Một drag 100 pointer updates chỉ có một Undo entry.
- Một lần Enter rồi blur hoặc mixed delete cũng chỉ một entry.
- No-op/cancel/error sau Undo giữ nguyên redo branch. Edit mới thực sự thành công mới truncate redo.
- Giữ giới hạn 50 entries; vượt giới hạn chỉ bỏ operation cũ nhất, cursor vẫn đúng.
- Edit commands và Undo/Redo của chúng cập nhật updatedAt theo Step 2; kiểm tra khôi phục nội dung/geometry phải tách timestamp này. Replacement commands vẫn phục hồi full snapshots như đã chốt.
- Selection, focus, pan/zoom, hover, draft keystrokes và preview không vào history.

Không thêm checkpoint từng frame hoặc library history song song với CommandEngine.

## 11. Tương tác với toolbar và operation khác

Một đầu mối editor interaction phải settle/cancel session trước khi workspace thực hiện operation. Không để thứ tự DOM blur tự tạo hidden command ngoài policy.

Khi bắt đầu drag/nudge/connect/reconnect mà label editor khác còn mở, settle draft theo blur policy đúng một lần, rồi mới lấy revision/snapshot cho gesture mới. Draft invalid bị hủy về giá trị cũ kèm notice. Không để blur phát sau Begin làm transaction mới dùng revision cũ; arrows khi input còn sở hữu focus vẫn chỉ di chuyển caret, không tự bắt đầu nudge.

| Tình huống | Policy |
| --- | --- |
| Save/Export khi label draft đang mở | Commit draft hợp lệ đúng một lần trước khi lấy snapshot; draft invalid được hủy về text cũ và báo rõ |
| Save/Export khi drag/nudge/connect preview chưa kết thúc | Hủy preview, thông báo thao tác chưa chốt đã hủy; lưu/export canonical snapshot, không âm thầm lưu preview |
| Toolbar Undo/Redo/Delete/Load/Import/Generate/Clear khi draft/gesture đang mở | Hủy interaction trước, rồi thực hiện operation; chặn blur muộn commit ngược lại |
| Ctrl/Meta+Z trong input | Native text undo, không engine undo |
| Thay theme hoặc toast render | Giữ selection/draft/preview; không command |
| Canonical document thay từ operation hợp lệ | Hủy session cũ trước khi render state mới; late callbacks không được tác động |

Mouse/pointer capture trên toolbar có thể cần settle/cancel trước blur để đạt policy. Save fail vẫn theo Step 2: không giả báo saved, không rollback edit đã commit hợp lệ.

Selection không cần tồn tại qua reload. Port choices, labels và committed geometry phải tồn tại qua Save/Load/JSON round trip. Sau reload vẫn sửa và Undo các thao tác mới được.

## 12. Module và thay đổi dự kiến

```text
src/core/editor/
  hierarchy.ts                     # Descendant closure theo semantics
  selection.ts                     # Session selection, không ghi Document
  moveTransaction.ts               # Begin/update/end/cancel, common delta
  deletePlan.ts                    # Một kế hoạch cascade atomic
  connectionPorts.ts               # PortSide ↔ named handles, defaults
  editSession.ts                   # Commit/cancel/IME/no-op lifecycle
src/core/commands/
  types.ts
  commands.ts                      # Hoặc tách files theo command nếu cần
  commandEngine.ts                 # Validate-before-commit, no-op/history
src/core/diagram/
  types.ts
  schema.ts
  validator.ts                     # Optional presentation.connections
src/components/canvas/
  KoraCanvas.tsx                    # Projection, controlled changes, controller
  AwsServiceNode.tsx
  ContainerNode.tsx
  AwsConnectionEdge.tsx
  ConnectionSelector.tsx           # Chọn từng parallel edge trùng path
  canvas.css                       # Hit targets, focus, layering, edit controls
src/components/toolbar/CanvasToolbar.tsx
src/app/page.tsx                    # Keyboard ownership, Step 2 coordination
tests/fixtures/editor/*
scripts/test-editor-commands.ts
scripts/test-editor-transactions.ts
```

Đây là phân chia trách nhiệm, không yêu cầu tạo file rỗng hoặc thêm framework. Có thể gom helpers nhỏ; không để toàn bộ logic subtree/history lẫn trong callbacks TSX. Tái sử dụng shared validator và operation coordinator của Step 2.

## 13. Test và evidence

### 13.1. Fixtures

- Tái sử dụng B1/B2/B3 của Step 1; B3 có VPC, hai private subnets, Backend A/B, cùng CloudFront/S3/ALB/DynamoDB để kiểm tra cross-boundary edges.
- Thêm nested container sâu hơn một cấp dưới subnet, một node có membership trong subtree nhưng geometry nằm ngoài boundary, container rỗng và external node có edge đi vào subtree.
- Có tọa độ âm/thập phân/off-grid, unknown assetId, legacy Document không có edge presentation, sparse side map, parallel edges và self-loop.
- Editor tests được phép dựng Document hợp lệ với geometry cố định để tách khỏi lỗi ELK; không gọi đó là bằng chứng Generate/AI. Browser vẫn phải có ít nhất một flow Generate Quick Test B2 thật.

### 13.2. Unit và integration offline

| ID | Case | Kỳ vọng |
| --- | --- | --- |
| E01 | Click/additive selection, marquee và rerender | Đúng tập session IDs; không đổi Document/history |
| E02 | Drag một node, 100 updates | Edges preview bám theo; một command, một Undo/Redo |
| E03 | Drag hai nodes từ một selected node và từ selection overlay | Selection giữ qua Begin, overlay anchor xác định, cùng delta, không double commit |
| E04 | Drag VPC/subnet/nested group | Đúng descendant closure; ancestors/siblings ngoài tập giữ nguyên |
| E05 | Selected ancestor + descendant + leaf khác | Union IDs; mỗi entity dịch một lần |
| E06 | Member nằm ngoài boundary; leaf thả sang subnet khác | Member vẫn đi với subtree; không auto-reparent/resize |
| E07 | Snap on/off, coordinates thập phân, zoom khác 100% | Common delta đúng, offsets không bị rounding riêng |
| E08 | Zero move, trở lại điểm đầu, Escape, blur/hidden/unmount | Không dispatch/revision/timestamp change; redo giữ nguyên |
| E09 | Late stop sau cancel/replacement, entity mất giữa gesture | Bỏ toàn bộ candidate, không partial move |
| E10 | Arrow key repeat, mixed node/container selection | Một gesture/command, không native nudge trùng |
| E11 | Canonical short label mở rồi blur; custom/unknown asset label | Raw semantics không đổi nếu không sửa text |
| E12 | Node/container/edge label Enter→blur, Escape→blur, IME | Commit tối đa một lần; cancel/composition không tạo edit nhầm |
| E13 | Blank node/container, clear edge, unchanged undefined/empty edge | Đúng no-op/clear policy; không mất redo |
| E14 | Node rename làm thay kích thước; container rename | Đúng semantic map, geometry resolver và Undo đầy đủ |
| E15 | Create parallel edges trùng path và self-loop | IDs khác nhau, không deduplicate; từng edge chọn/sửa/xóa độc lập; redo giữ ID |
| E16 | Reconnect source/target/side-only | Endpoints+presentation nguyên tử; giữ label/relationship/description |
| E17 | Invalid drop, wrong role, missing endpoint, reconnect no-op | Giữ edge cũ/history; không thêm defaults giả |
| E18 | Side map optional/sparse, enum sai, orphan entry, legacy load | Validator đúng contract, round trip không materialize defaults |
| E19 | Mixed delete node+edge+container, ancestor+child cùng selected | Một delete command, closure đúng và không orphan |
| E20 | Delete empty container/system Cloud/toàn diagram | Document hợp lệ; external ngoài subtree giữ nguyên |
| E21 | Undo/Redo delete/reconnect/rename/move | Phục hồi nội dung, geometry và optional-field absence |
| E22 | No-op/validation failure sau Undo | Redo branch và cursor còn đúng |
| E23 | 51+ operations, Undo/Redo đến giới hạn rồi edit mới | 50 entries đúng; không lệch cursor/IDs |
| E24 | Input text shortcuts/contenteditable và canvas shortcuts | Đúng keyboard owner, không xóa diagram khi gõ chữ |
| E25 | Pending Generate/Layout/Import rồi Begin editor gesture | Stale replacement không thắng; status muộn không đè status mới |
| E26 | Toolbar hoặc input Ctrl/Meta+S khi interaction đang mở; chuyển label edit sang gesture khác | Settle/cancel đúng policy trước snapshot, ngăn browser Save, không blur command muộn |
| E27 | Save/Load/Export/Import sau nhiều edits | Committed geometry/labels/side choices/asset identity giữ nguyên |
| E28 | Frozen command inputs, failed execute/undo/redo | Không mutation; state/cursor/revision không đổi khi thất bại |

Assertions so sánh tập ID và field values, không chỉ counts/`canUndo`. Kiểm tra expected positions từ fixture và delta cụ thể. Với no-op so sánh cả metadata/revision/redo; với successful edit Undo so sánh nội dung theo timestamp policy ở mục 10.

Test commands/controller độc lập bằng tsx và fake events/deferred operations; kết quả về hit targets, focus, IME và edge attachment vẫn cần browser evidence. Test mới trả nonzero nếu có failure, không dùng console log thay assertions.

### 13.3. Browser acceptance

Viewport chuẩn 1440×900, browser zoom 100%; kiểm tra canvas zoom 50%, 100%, 150% và cả light/dark cho hit targets/layering. Ghi rõ phiên bản app/browser và source identity.

1. Generate Quick Test B2 → chọn ECS/ALB → kéo cùng nhau → Undo/Redo. Kiểm tra edges bám trong lúc kéo và sau drop.
2. Import B3 → kéo VPC header → kéo riêng Subnet A → chọn cả VPC và Backend A rồi kéo. Subtree offsets giữ nguyên, Backend A không di chuyển hai lần.
3. Marquee quanh hai backend không chọn enclosing Cloud/VPC. Container selected vẫn ở phía sau child; header/input không chặn thao tác child.
4. Kiểm tra đủ source/target handles ở bốn phía đều hittable. Tạo edge bằng sides khác default, reconnect cả hai đầu và side-only, thử drop vào pane và Escape. Self-loop có đường nhìn thấy để select/edit; hai parallel edges trùng path đều chọn và sửa độc lập qua connection selector.
5. Rename node/container/edge bằng text tiếng Việt có IME; mở canonical label rồi blur không gõ; Enter/Escape rồi blur không sinh history nhầm.
6. Xóa selection gồm container và edge ngoài subtree → một Undo phục hồi đủ. Xóa container rỗng, xóa Cloud và Undo; không xuất hiện Cloud tự tái tạo.
7. Khi input có focus, Delete/Ctrl+Z chỉ tác động text, Ctrl+S commit draft rồi Save mà không mở browser Save Page. Khi canvas focus, arrows/hold, Delete và Undo/Redo đúng selection.
8. Bắt đầu drag rồi Escape/blur; thử kết quả Generate/Layout chậm hoàn tất sau Begin. Không có jump, lost edit hoặc commit muộn.
9. Save bằng toolbar và Ctrl+S → reload → Export/Import: tọa độ, labels và port choices giữ đúng; vẫn sửa tiếp được.
10. Chạy Auto Layout một lần: semantics và explicit side choices còn nguyên, một Undo trả geometry cũ. Độ đẹp/routing được ghi riêng cho Step 4.

Lưu clip hoặc chuỗi screenshots cho drag/reconnect/IME, JSON trước/sau cho persistence, và kết quả history sau mỗi operation. Một screenshot cuối hoặc diagnostics counts không chứng minh gesture/history hoạt động.

## 14. Thứ tự triển khai và verification

1. Xác nhận code thực tế, baseline và Step 2; bảo toàn thay đổi ngoài phạm vi.
2. Chốt optional connection presentation, cập nhật schema/validator cùng compatibility tests trước khi UI ghi field mới.
3. Viết hierarchy/move/delete helpers và commands thuần; làm no-op, candidate validation và history tests.
4. Nối controlled selection/preview, drag/subtree/nudge và cancellation; kiểm tra rerender không làm mất preview.
5. Nối label sessions và keyboard ownership, rồi create/reconnect/handle hit targets.
6. Nối atomic deletion, toolbar settlement và Step 2 operation guards.
7. Chạy unit/integration, typecheck/build, regression rồi browser acceptance; sửa đủ lỗi trong scope trước khi nghiệm thu.

Lệnh dự kiến từ `D:\Project\Kora`:

```powershell
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

Các scripts của Step 2 là phụ thuộc dự kiến, phải kiểm tra đã tồn tại. Chạy parser regression offline với Gemini key bị cô lập theo Step 1; lint nếu đã cấu hình. Không cần gọi provider có phí hoặc nâng dependency để chứng minh editor.

Sau khi sửa nhiều TSX components, áp dụng checklist React của repo/skill hiện có về hooks, accessibility và controlled state. Kiểm tra build trên source cuối; không dùng log trước khi sửa làm bằng chứng cho code mới.

Deliverables khi thực hiện: source/schema thay đổi, test fixtures/runners, log verification và `docs/editor/<run-id>/report.md`. Báo cáo phải nêu contract presentation mới, compatibility một chiều, kết quả E01–E28, browser evidence và các vấn đề layout còn dành cho Step 4. Spec này chưa tạo các deliverables triển khai đó.

## 15. Điều kiện nghiệm thu

- [ ] Selection/preview là session state, Document vẫn là canonical source; tọa độ tuyệt đối không bị đổi ngầm.
- [ ] Node, multi-node, container và mixed subtree movement dùng một delta, một transaction, một Undo.
- [ ] Snap/nudge/zoom không làm mất relative offsets; cancel/no-op/late callbacks không đổi state hoặc mất redo.
- [ ] Label edit đúng map, raw text và IME; Enter/blur/Escape kết thúc session tối đa một lần.
- [ ] Create/reconnect giữ đúng node/side, ID ổn định; parallel edges/self-loops hợp lệ không bị bỏ.
- [ ] Optional connection presentation đã được validate và round-trip; legacy V1 không bị tự chèn defaults.
- [ ] Delete selection cascade đúng membership, một history entry, Undo phục hồi đủ và không có dangling records.
- [ ] Command failure/Undo/Redo validation failure không dịch cursor trước khi thành công; history 50 entries hoạt động đúng.
- [ ] Toolbar/keyboard ownership và Step 2 acceptance guards settle/cancel đúng policy, không commit muộn hoặc làm mất thay đổi đã chốt ngoài ý muốn.
- [ ] E01–E28, browser acceptance, typecheck và build có bằng chứng pass; regression đối chiếu với baseline.
- [ ] Save/Load/Export/Import giữ kết quả edits và side choices; reload vẫn chỉnh được, không yêu cầu giữ history phiên trước.
- [ ] Report phân biệt rõ editor đã hoàn thiện với layout/routing chưa được tối ưu; không dùng sự tồn tại handlers làm bằng chứng hoàn thành.

**Kết quả mong đợi:** diagram sau Generate thực sự là tài liệu chỉnh sửa được; người dùng có thể sửa rồi Undo, lưu và mở lại mà không mất cấu trúc hoặc vị trí đã chốt.
