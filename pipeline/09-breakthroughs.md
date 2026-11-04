# 09 — Phần khác biệt và optional work

## 1. Core evidence

Mission budget + receipt là bằng chứng của use case, không để tới sau khi làm stretch.
S1 cần basic result/payment receipt và budget; S3 hoàn thiện public export/checkpoint/offline verifier.
Định dạng/hashes/privacy do 04 sở hữu, payment proof do 02 sở hữu, không định nghĩa lại ở đây.

Điểm sản phẩm đáng chứng minh:
- Một nhiệm vụ có người giao, deliverable và expiry.
- Hai budget riêng; tool reserved là tiền có thể còn settle, không phải số trang trí.
- Owner lấy lại result đã trả tiền dù mission hết hạn hoặc app restart.
- Receipt nối actual result bytes, policy snapshot và chain payment; không chứng minh quality tự động.
Các thành phần đã có tiền lệ trong [build sources](../context/build-sources.md).
Không claim novelty của từng primitive, không tự suy đã hơn mọi đối thủ vì có nhiều layer.

## 2. Optional theo thứ tự, chỉ sau gates core

1. **Policy replay simulation:** cùng proposal và snapshot, chạy validator với permissive/current/strict,
   hiện auto/queue/block và reason. Không broadcast tx. Có thể dùng eth_call/fork để đối chiếu mà không chuyển tiền thật;
   không gọi mọi read-only on-chain simulation là double-spend.
2. **Attack replay UI:** dataset cố định owner-authorized trên ví test riêng; không public arbitrary signer.
   Hiện attacker balance/guard state và positive control, không chỉ video “blocked”.
3. **Reputation tier:** chỉ mở access tool với trusted-client evidence rõ, không tăng cap/allowlist/quyền quỹ.
   Nếu không enforce provenance theo app thì bỏ.
4. **Rolling cap:** thay UTC day bằng window thực sự, phải cập nhật contract/state/tests/manifest/demo;
   không claim bucket xấp xỉ là exact rolling 24h.
5. **Conditional approve:** owner tạo proposal mới amount khác, reject proposal cũ; không sửa approved intent ngầm.
6. **Multisig/timelock:** ngoài owner cố định MVP, cần spec migration và tests riêng.
   Chỉ nếu core đã hoàn thành trước freeze, không đổi owner model giữa demo.

## 3. Không mở rộng trong MVP

Không token riêng, yield/lending treasury, arbitrary-code Actor sandbox, mainnet/cross-chain,
full meeting app/microphone, validation registry, auto-approve queue hoặc auto-refill agent wallet.
Không dùng reputation để tự cấp quyền. Không thêm dashboard marketing/analytics lớn.
Khi trễ, cắt optional trước; không cắt idempotency/auth/recovery để giữ feature mới.
Feature freeze 17/11/2026; sau đó chỉ fix/record/link.
