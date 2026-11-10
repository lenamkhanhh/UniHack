# MissionPay Production Deployment Checklist

**Mục tiêu:** Tài liệu hướng dẫn cấu hình, kiểm tra môi trường và sẵn sàng triển khai (Production Readiness) cho ứng dụng MissionPay trên hạ tầng đám mây (Vercel / AWS / GCP) và Hosted PostgreSQL (Supabase / Neon), tuân thủ nguyên tắc không deploy thực tế khi chưa có lệnh phê duyệt của Owner.

---

## 1. Yêu Cầu Biến Môi Trường (Environment Variables)

Mọi biến môi trường dưới đây phải được cấu hình bằng giá trị thật trên dashboard hosting (Vercel / AWS / GCP) trước khi chạy. Tuyệt đối không commit giá trị secret vào git.

| Tên Biến | Getter / Source | Mô Tả & Placeholder | Tính Bảo Mật |
|---|---|---|---|
| `DATABASE_URL` | `db.ts` | Connection string PostgreSQL có pooling: `postgresql://<user>:<password>@<host>:<port>/<dbname>?sslmode=require&pgbouncer=true` | **Secret (Tuyệt mật)** |
| `DIRECT_URL` | `schema.prisma` | Connection string PostgreSQL trực tiếp: `postgresql://<user>:<password>@<host>:<port>/<dbname>?sslmode=require` | **Secret (Tuyệt mật)** |
| `MISSION_TOKEN_SECRET` | `getJwtSecret` | Chuỗi khóa ký HMAC JWT cho mission session token: `<min-32-chars-random-secret>` | **Secret (Tuyệt mật)** |
| `SESSION_WALLET_SEED` | `getSessionWalletSeed` | Seed sinh ví phiên EOA cho từng mission: `<32-bytes-hex-seed>` | **Secret (Tuyệt mật)** |
| `DEPLOYMENT_ID` | `getDeploymentId` | Định danh phiên bản deploy: `unihack-prod-<env>` | Config / Public |
| `APP_ORIGIN`<br>`NEXT_PUBLIC_APP_ORIGIN` | `getAppOrigin` | Domain công khai chính thức: `https://<your-domain>.vercel.app` | Public |
| `PAYMENT_MODE` | `getPaymentMode` | Chế độ thanh toán: `MOCK` hoặc `LIVE_FUJI` | Config |
| `AVALANCHE_FUJI_RPC_URL` | viem public client | Endpoint RPC Fuji C-Chain: `https://api.avax-test.network/ext/bc/C/rpc` hoặc QuickNode/Infura riêng | Config |
| `OWNER_ADDRESS` | `getConfiguredOwner` | Địa chỉ ví Owner (20-byte hex): `0x<40-hex-characters-owner-address>` | Public |
| `AGENT_PRIVATE_KEY` | `getConfiguredAgentPrivateKey` | Khóa riêng EOA Agent (32-byte hex): `0x<64-hex-characters-agent-key>` | **Secret (Tuyệt mật)** |
| `SELLER_ADDRESS` | `validateLiveFujiConfigSync` | Địa chỉ ví merchant bán tool (20-byte hex): `0x<40-hex-characters-seller-address>` | Public |
| `GUARDED_TREASURY_ADDRESS`<br>`NEXT_PUBLIC_GUARD_ADDRESS` | `getGuardedTreasuryAddress` | Địa chỉ contract GuardedTreasury đã verified: `0x<40-hex-characters-treasury-address>` | Public |
| `VALIDATION_REGISTRY_ADDRESS`<br>`NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS` | `getValidationRegistryAddress` | Địa chỉ ValidationRegistry (ERC-8004): `0x<40-hex-characters-registry-address>` | Public |
| `ERC8004_AGENT_ID`<br>`NEXT_PUBLIC_ERC8004_AGENT_ID` | `getErc8004AgentId` | Token ID của Agent đăng ký trên ERC-8004 Registry (e.g. `294`) | Public |
| `PASSKEY_AUTHORITY_ADDRESS`<br>`NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS` | `getPasskeyAuthorityAddress` | Địa chỉ PasskeyMissionAuthority (RIP-7212): `0x<40-hex-characters-authority-address>` | Public |
| `VALIDATOR_PRIVATE_KEY` | `getValidatorPrivateKey` | Khóa riêng của Validator độc lập (M7 runner): `0x<64-hex-characters-validator-key>` | **Secret (Tuyệt mật)** |
| `VALIDATOR_ADDRESS`<br>`NEXT_PUBLIC_VALIDATOR_ADDRESS` | `runMissionValidatorJob` | Địa chỉ công khai của Validator độc lập: `0x<40-hex-characters-validator-address>` | Public |
| `RELAYER_PRIVATE_KEY` | `/api/passkey/relay` | Khóa riêng EOA Relayer tài trợ gas cho WebAuthn passkey (tách biệt khỏi Owner): `0x<64-hex-characters-relayer-key>` | **Secret (Tuyệt mật)** |
| `LLM_API_KEY` | `agent.ts`, `bounty.ts` | API Key Google Gemini cho LLM Planner và Bounty Challenge: `<google-ai-studio-gemini-key>`. *Nếu vắng mặt: hệ thống tự động kích hoạt fallback deterministic có gắn nhãn trung thực, không làm hỏng static build.* | **Secret (Tuyệt mật)** |
| `BOUNTY_INTERNAL_SECRET` | `/api/bounty/attempt` | Khóa bí mật dùng cho internal test harness phân loại source=test/smoke (x-bounty-auth-key): `<min-32-chars-bounty-secret>`. *Không có key mặc định.* | **Secret (Harness)** |
| `TRUSTED_INGRESS` | `resolveClientIp` | Xác định nền tảng reverse proxy tin cậy để đọc IP client (`cloudflare`, `gcp`, `none`). Khi vắng mặt hoặc `none`, các IP unverified tự động gom vào shared bucket an toàn để chống xoay vòng header bypass rate limit. | Config |
| `ARENA_PRESENTER_KEY` | `arena.ts` | Khóa bí mật dùng cho người thuyết trình đặt lại bộ đếm Stage (`/stage`): `<presenter-passcode>` | **Secret (Presenter)** |

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
   - Đã cấu hình atomic PostgreSQL reservation rate limit: 5 requests/phút cho mỗi IP và 300 requests/ngày toàn cục tại `/api/bounty/attempt`. Database failure tự động fail-closed (từ chối suy luận đắt tiền).
   - Các route quản trị (`resetArenaAction`) sử dụng so sánh `timingSafeEqual` với biến môi trường `ARENA_PRESENTER_KEY`.

---

## 3. Quy Trình Kiểm Tra Sức Khỏe Trước Giờ G (Pre-Flight Health Checks)

Trước khi bật trình chiếu hoặc gửi link cho ban giám khảo:
1. **Kiểm tra endpoint `/api/health`:**
   - Trả về HTTP 200 OK.
   - `chainId`: 43113.
   - `database`: `connected`.
   - `treasuryAddress`: `0x20451c1e2dCD83F166B4f22868BAdECb5868d545` *(Lưu ý: Địa chỉ Fuji lịch sử này CHƯA bao gồm các bản vá contracts/ mới; hợp đồng đã vá chỉ có trong repo local, việc redeploy Fuji cần lệnh duyệt của Owner)*.
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
# Lệnh build chính thức từ root (xây dựng @missionpay/guard trước khi build web)
npm run build
```
- Kết quả: Build thành công (Exit code 0), tất cả các trang SSG/SSR compile sạch, không có cảnh báo Type error hay ESLint error.

---

## 5. Danh Sách Migration Cơ Sở Dữ Liệu Thực Tế (Prisma Migrations)

Các migration đã được triển khai và kiểm thử tính toàn vẹn trên database sạch:
1. `20261104000000_init`: Khởi tạo bảng Mission, ToolSession, ToolOperation, AuditHead, AuditEntry, MissionFeedback.
2. `20261104100000_round2_hardening`: Thêm các ràng buộc bảo mật, bảng TreasuryRequest.
3. `20261107120000_payee_root`: Bổ sung payeeRoot và quản lý danh sách payee cho Mission.
4. `20261110000000_validation_job_and_bounty`: Thêm bảng `BountyAttempt` và `ValidationJob`, thêm `creationBlock` vào `Mission`.
5. `20261110120000_bounty_quota_reservation`: Thêm bảng `BountyQuotaReservation` cho cơ chế atomic reservation rate limiting đa instance.
