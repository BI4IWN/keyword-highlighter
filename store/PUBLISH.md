# 发布到 Chrome Web Store 操作手册

> 前置：注册开发者账号需**一次性支付 5 美元**（信用卡/PayPal），此步骤只能由账号所有者本人完成。
> 开发者后台：https://chrome.google.com/webstore/devconsole

## 方式 A：网页后端手动提交（首次推荐）

1. **注册开发者账号**：打开上面后台地址，用 Google 账号登录并支付 5 美元注册费
2. **上传安装包**：「新增及概览」→「新增 item」→ 上传 `dist/` 目录下的
   `keyword-highlighter-v1.3.0.zip`（由 `npm run pack` 生成，只含运行时文件）
3. **商店Listing（商品详情）**：按 `store/listing.md` 逐栏复制；
   截图使用 `store/screenshots/` 下的 3 张 1280×800 图片，商店图标已内置在包中
4. **隐私权规范（Privacy practices）**：
   - 按 `store/permissions.md` 填写单一用途与权限理由
   - 隐私政策网址填：`https://github.com/BI4IWN/keyword-highlighter/blob/main/PRIVACY.md`
   - 数据披露按其中的勾选建议逐项选择"否"
5. **分发设置**：公开 / 所有地区（可按需改）
6. **提交审核**（Submit for review）

⚠️ 本扩展申请了 `<all_urls>` 主机权限，会触发**深度人工审核**，通常需要数个工作日到数周，
期间状态会停留在"正在审核"，被拒可按回复补充说明后重新提交。

## 方式 B：API 自动发布（后续版本迭代用）

一次性准备（约 10 分钟）：

1. 打开 https://console.cloud.google.com 新建项目（如 `keyword-highlighter`）
2. 「API 和服务 → 库」搜索启用 **Chrome Web Store API**
3. 「凭据 → 创建凭据 → OAuth 客户端 ID」→ 类型选"桌面应用"，记下 **Client ID / Client Secret**
4. 获取 refresh token：访问
   https://chrome.google.com/webstore/devconsole（确保已登录并开通开发者账号），
   然后使用 https://developers.google.com/oauthplayground ：
   右上角齿轮 → 勾选"Use your own OAuth credentials"填入上一步的 ID/Secret →
   左侧 Input your own scope 填 `https://www.googleapis.com/auth/chromewebstore` →
   授权并换取 refresh token

之后每次发版只需：

```bash
npm run pack   # 生成 dist/keyword-highlighter-vX.Y.Z.zip

EXT_ID=你的itemID \
CLIENT_ID=xxx CLIENT_SECRET=xxx REFRESH_TOKEN=xxx \
npx chrome-webstore-upload-cli@latest upload \
  --source dist/keyword-highlighter-v1.3.0.zip --auto-publish
```

（建议把凭据放进 `.env` 或 CI Secrets，不要写进仓库；上传后审核流程与方式 A 相同）
