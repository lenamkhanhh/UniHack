# MissionPay Production Deployment Checklist

**Mục tiêu:** Tài liệu hướng dẫn cấu hình, kiểm tra môi trường và sẵn sàng triển khai (Production Readiness) cho ứng dụng MissionPay trên hạ tầng đám mây (Vercel / AWS / GCP) và Hosted PostgreSQL (Supabase / Neon), tuân thủ nguyên tắc không deploy thực tế khi chưa có lệnh phê duyệt của Owner.

---

## 1. Yêu Cầu Biến Môi Trường (Environment Variables)

| Tên Biến | Môi Trường | Mô Tả & Giá Trị Chuẩn | Tính Bảo Mật |
|---|---|---|---|
| `DATABASE_URL` | Server | Connection string PostgreSQL có pooling (`pgbouncer=true` hoặc Neon serverless pooler, `sslmode=require`). | **Secret (Tuyệt mật)** |
| `NEXT_PUBLIC_APP_ORIGIN` | Public/Client | Domain công khai chính thức (ví dụ: `https://missionpay.vercel.app` hoặc `http://<ip>:3100` khi chiếu tại hội trường). | Public |
| `AVALANCHE_FUJI_RPC_URL` | Server/Client | RPC endpoint Avalanche Fuji C-Chain (`https://api.avax-test.network/ext/bc/C/rpc` hoặc QuickNode/Infura endpoint riêng). | Public / Config |
| `NEXT_PUBLIC_GUARDED_TREASURY_ADDRESS`<br>`GUARDED_TREASURY_ADDRESS` | Both | Địa chỉ smart contract GuardedTreasury đã verified trên Snowtrace: `0x20451c1e2dCD83F166B4f22868BAdECb5868d545`. | Public |
| `NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS` | Both | Địa chỉ ValidationRegistry (ERC-8004): `0x4c5ccda2a630cd1cb706799deadcc8483d06697e`. | Public |
| `NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS` | Both | Địa chỉ PasskeyMissionAuthority (RIP-7212): `0x77235386fe59A934645C5F273e411b0Bea8cCc9C`. | Public |
| `OWNER_ADDRESS` | Server | Địa chỉ ví Owner Builder Hub: `0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c`. | Public |
| `AGENT_ADDRESS` | Server | Địa chỉ ví Agent Session Runner: `0x374b8A126FDb9e5deEc8307da385076155Af3D72`. | Public |
| `GEMINI_API_KEY` | Server | Khóa API Google Gemini để gọi `gemini-3.5-flash-lite` cho LLM Planner và Bounty Challenge. | **Secret (Tuyệt mật)** |
| `ARENA_PRESENTER_KEY` | Server | Khóa bí mật dùng cho người thuyết trình đặt lại bộ đếm Stage (`/stage`). | **Secret (Presenter)** |
| `RELAYER_PRIVATE_KEY` | Server | Khóa riêng của EOA Relayer tài trợ gas cho WebAuthn Passkey (tách biệt hoàn toàn khỏi Owner). | **Secret (Tuyệt mật)** |

---

## 2. Cấu Hình Serverless & Kết Nối Cơ Sở Dữ Liệu

1. **Serverless Function Timeout:**
   - Các route agent orchestration (`/api/agent/run`), x402 settlement polling (`/api/tools/orchestrate`), và bounty challenge (`/api/bounty/attempt`) cần thời gian chờ tối thiểu **60 giây** để xử lý suy luận LLM và xác nhận transaction trên Fuji.
   - Cấu hình trong route Next.js:
     ```typescript
     export const maxDuration = 60; // 60 seconds (Vercel Pro/Hobby)
     export const dynamic = 'force-dynamic';
     ```

2. **Database Connection Pooling:**
   - Serverless functions có thể tạo hàng chục kết nối đồng thời trong thời gian diễn ra Demo Day.
   - Khuyến nghị sử dụng connection pooler (Prisma Accelerate hoặc Neon/Supabase PgBouncer) với tham số:
     `DATABASE_URL="postgres://user:pass@ep-pooler.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=10"`

3. **Chống Tấn Công Spam & Rate Limiting:**
   - Đã cấu hình trần toàn cục 60 requests/phút cho `/api/arena/attack` để chống tràn màn hình sân khấu.
   - Đã cấu hình rate limit 5 requests/phút cho mỗi IP tại `/api/bounty/attempt`.
   - Các route quản trị (`resetArenaAction`) sử dụng so sánh `timingSafeEqual` với biến môi trường `ARENA_PRESENTER_KEY`.

---

## 3. Quy Trình Kiểm Tra Sức Khỏe Trước Giờ G (Pre-Flight Health Checks)

Trước khi bật trình chiếu hoặc gửi link cho ban giám khảo:
1. **Kiểm tra endpoint `/api/health`:**
   - Trả về HTTP 200 OK.
   - `chainId`: 43113.
   - `database`: `connected`.
   - `treasuryAddress`: `0x20451c1e2dCD83F166B4f22868BAdECb5868d545`.
   - `latestBlock`: lớn hơn #60715000.
2. **Kiểm tra số dư gas ví Owner & Relayer trên Fuji:**
   - Owner EOA (`0x4BC9...`): $\ge 0.2$ AVAX.
   - Relayer EOA (`0x2e94...`): $\ge 0.02$ AVAX.
   - GuardedTreasury (`0x2045...`): $\ge 5.0$ Fuji USDC.
3. **Kiểm tra chế độ dự phòng Offline (Seed Mode):**
   - Màn hình `/stage` và `/verify/demo-seed` hỗ trợ chế độ demo seed dự phòng trong trường hợp mạng hội trường mất kết nối Internet.

---

## 4. Biên Bản Kiểm Tra Build Production

```bash
# Lệnh build chính thức
cd apps/web
npm run build
```
- Kết quả: Build thành công (Exit code 0), tất cả các trang SSG/SSR compile sạch, không có cảnh báo Type error hay ESLint error.
