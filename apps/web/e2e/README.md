# UniHack Browser E2E Test Suite (Playwright)

Tài liệu hướng dẫn vận hành bộ kiểm thử trình duyệt đầu-cuối (Browser E2E) cho dự án UniHack (Stage S1 - Avalanche Fuji x402 Gasless Payment & Guarded Treasury).

---

## 1. Kiến trúc Kiểm thử Trình duyệt (Architecture)

Bộ kiểm thử E2E được xây dựng trên nền tảng **Playwright Test**, phân định rõ ràng giữa hai tầng kiểm thử:

1. **Dự án `ui-mocked` (Mocked Network & Isolated UI Testing):**
   - **`mission-lifecycle.spec.ts`**: Kiểm thử trọn vẹn 8 bước vòng đời trên giao diện `/demo`: kết nối ví EIP-1193, lấy thử thách, tạo mission, kích hoạt nhận Spend JWT, thanh toán tìm kiếm, TalkMeter start/tick/stop và xuất proof. Sử dụng selector scoped theo `data-testid` (`[data-testid="step-policy"]`, `[data-testid="step-talkmeter"]`, v.v.).
   - **`pending-and-publication.spec.ts`**: Kiểm thử hiển thị dashboard `/` (empty state, dual-budget card), kiểm tra **bất biến trung thực SUBMITTING & UNKNOWN** (khi tick trả về HTTP 202 SUBMITTING/UNKNOWN, giao diện hiển thị `PENDING` và dừng luồng trước Step 7 Complete, không credit thành công giả), và ranh giới bảo mật public/private (từ chối 401 nặc danh cho private proof).
   - **Yêu cầu môi trường:** Chỉ cần Chromium browser binary và máy chủ Next.js dev server; không phụ thuộc vào cơ sở dữ liệu thật vì các API cuộc gọi được intercept có kiểm soát.

2. **Dự án `real-integration` (Unmocked Vertical Flow):**
   - **`real-integration.spec.ts`**: Kịch bản kiểm thử tích hợp thực sự không mock API (`no page.route()`). Kết nối ví mock EIP-1193 vào trang `/demo` và gửi request HTTP thật xuyên suốt: Trình duyệt -> Route Handlers -> Prisma -> PostgreSQL Test Database -> Phản hồi -> Giao diện DOM.
   - **Yêu cầu môi trường:** Cần đồng thời cả Chromium browser binary VÀ daemon PostgreSQL test database (cổng 55432) hoạt động.

3. **Cơ chế Tiêm Ví An Toàn (Isolated Mock EIP-1193 Provider):**
   - [fixtures/wallet.ts](fixtures/wallet.ts) tiêm đối tượng `window.ethereum` chuẩn EIP-1193 vào trình duyệt thông qua `page.exposeFunction('__mockSignMessage')` và `page.addInitScript()`.
   - Khóa cá nhân (`privateKey`) nằm hoàn toàn trong tiến trình Node của test runner, **tuyệt đối không nhúng private key vào browser DOM hay JavaScript context của trang web**.

---

## 2. Phân định Trạng thái Nghiệm thu (Honest Validation Gates)

Tuân thủ nghiêm ngặt chuẩn mực phân định các tầng kiểm chứng độc lập:

| Tầng kiểm định | Trạng thái kỹ thuật | Điều kiện tiên quyết & Ghi chú |
|---|---|---|
| **Playwright Runner & Specs Discovery** | **IMPLEMENTED (8/8 tests discovered)** | Cấu hình Playwright, fixtures, 3 spec files và test discovery hoàn tất 100% (Exit Code 0). |
| **Chromium Browser Binaries** | **NOT_EXECUTED** | Cần tải binary trình duyệt: `npx playwright install chromium` (mặc định chưa có trong môi trường headless). |
| **PostgreSQL Test Database Daemon** | **ENVIRONMENT_BLOCKED** | Dịch vụ PostgreSQL daemon (cổng 55432) chưa hoạt động trong môi trường sandbox hiện tại (`connect ECONNREFUSED 127.0.0.1:55432`). |
| **Handler Lifecycle (Vitest Node)** | **HANDLER_VERIFIED_WITH_MOCKS** | Bộ kiểm thử [handler-lifecycle.test.ts](../tests/handler-lifecycle.test.ts) chạy dưới Node pass 100% với mock services. |

---

## 3. Lệnh Vận hành Kiểm thử (Execution Commands)

### A. Kiểm tra Test Discovery (Không khởi chạy trình duyệt)
Chạy từ thư mục gốc `UniHack`:
```powershell
node node_modules/@playwright/test/cli.js test --config apps/web/playwright.config.ts --list
```

### B. Chạy kiểm thử UI-Mocked khi đã cài Chromium Binary
```powershell
npx playwright test --config apps/web/playwright.config.ts --project=ui-mocked
```

### C. Chạy kiểm thử Real Integration khi có cả Chromium Binary và PostgreSQL Test Daemon
Khi cổng `55432` đã hoạt động và database test chuyên dụng đã sẵn sàng:
```powershell
npx playwright test --config apps/web/playwright.config.ts --project=real-integration
```

### D. Xem Báo cáo Kiểm thử & Traces
- **HTML Report:** `playwright-report/index.html`
- **JSON Results:** `playwright-report/test-results.json`
- **Traces & Screenshots:** Tự động ghi lại khi có lỗi (`trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`).
