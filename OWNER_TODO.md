# OWNER_TODO: DANH MỤC CÔNG VIỆC CẦN OWNER DUYỆT & THỰC HIỆN

**Cập nhật:** 2026-11-13 13:45 (Asia/Saigon) | **Nhánh:** `feat/s1-app`  
**Milestone:** `P1-B — Avalanche ICM Cross-L1 Mission Budgeting (Dispatch Testnet ↔ Fuji C-Chain)` & `P1-A — Twin Treasury`

---

## 1. YÊU CẦU DUY NHẤT CẦN OWNER THỰC HIỆN ĐỂ MỞ LIVE ICM (P1-B)

Nhờ hoàn thiện kiến trúc **Self-Relay** (`scripts/m9-self-relay.ts`) qua Ava Labs Glacier Signature Aggregator và EIP-2930 access list delivery, hệ thống **không còn phụ thuộc vào relayer công cộng của bên thứ ba**.
Đồng thời, endpoint Glacier Aggregator hoạt động **hoàn toàn miễn phí không cần API key** (đã kiểm chứng live 100%).

Do đó, Owner **CHỈ CẦN THỰC HIỆN 2 BƯỚC DUY NHẤT SAU**:

### Bước 1: Xin Faucet token testnet DISPATCH cho 2 ví (5 phút)
Truy cập: [Avalanche Core Testnet Faucet](https://core.app/tools/testnet-faucet/?subnet=dispatch) hoặc Builder Hub Faucet:
1. **Ví Owner:** `0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c` (~0.5 - 1.0 DISPATCH để deploy Gateway và chạy stranger scenario).
2. **Ví Agent:** `0x374b8A126FDb9e5deEc8307da385076155Af3D72` (~0.1 - 0.2 DISPATCH để gửi `sendSpendRequest`).

*(Ví Relayer trên Fuji `0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA` đã có sẵn 0.02 AVAX, đủ cho ~20 giao dịch delivery, không cần nạp thêm).*

### Bước 2: Phê duyệt Broadcast
Sau khi nạp token, Owner cấp lệnh cho phép broadcast bằng cách bật cờ môi trường:
```bash
$env:M9_ALLOW_BROADCAST = "1"
```
Và báo lại để agent tiến hành broadcast deployment và chạy live runner:
```bash
npm run worker:validation # hoặc npx tsx scripts/m9-live-icm.ts
```

---

## 2. LỆNH KIỂM TRA PREFLIGHT NHANH (KHÔNG TỐN GAS, KHÔNG GỬI TX)

Owner hoặc reviewer có thể kiểm tra trạng thái số dư và cấu hình bất kỳ lúc nào bằng lệnh:
```bash
npx tsx scripts/m9-live-icm.ts --preflight
```
Lệnh này sẽ tự động đọc số dư từ RPC Dispatch và Fuji, kiểm tra cấu hình contract và in ra chính xác các bước còn thiếu.

---

## 3. LƯU Ý VỀ AN TOÀN VÀ BẢO MẬT

1. **Khóa riêng tư Validator (M7-F1):**
   - Đã được amend ở commit `cc58ea3` sang đọc từ biến môi trường.
   - Cam kết: Không chạy `git reflog expire` / `git prune` trong lúc review. Khi chuẩn bị public repo, Owner sẽ thực hiện xoay ví validator trên Fuji và dọn dẹp reflog theo quy trình đã hướng dẫn.
2. **Kỷ luật Testnet:**
   - Tuyệt đối không broadcast khi chưa có `M9_ALLOW_BROADCAST=1` hoặc `TWIN_ALLOW_BROADCAST=1`.
   - Toàn bộ kịch bản test mặc định ở chế độ `--dry-run`.
