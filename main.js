const ASSET_DIR = "assets/RecognitionObjects";

const PULL_MODE = normalizePullMode(settings.pullMode);
const SKIP_ANIMATION = settings.skipAnimation === true;
const RESULT_SETTLE_DELAY_MS = parsePositiveInt(settings.resultSettleDelayMs, 2500);
const ANIMATION_TIMEOUT_MS = parsePositiveInt(settings.animationTimeoutMs, 45000);
const RETURN_TIMEOUT_MS = parsePositiveInt(settings.returnTimeoutMs, 15000);

const RESOURCE_POLICIES = {
    "角色活动祈愿": normalizePolicy(settings.character1ResourcePolicy),
    "角色活动祈愿-2": normalizePolicy(settings.character2ResourcePolicy),
    "武器活动祈愿": normalizePolicy(settings.weaponResourcePolicy),
    "常驻祈愿": normalizePolicy(settings.standardResourcePolicy)
};

const BANNER_DEFS = [
    {
        key: "角色活动祈愿-2",
        file: "BannerCharacter2.png",
        ocrTexts: ["角色活动祈愿-2", "角色活动祈愿2"]
    },
    {
        key: "角色活动祈愿",
        file: "BannerCharacter1.png",
        ocrTexts: ["角色活动祈愿"]
    },
    {
        key: "武器活动祈愿",
        file: "BannerWeapon.png",
        ocrTexts: ["武器活动祈愿"]
    },
    {
        key: "常驻祈愿",
        file: "BannerStandard.png",
        ocrTexts: ["常驻祈愿"]
    }
];

const assets = {
    wishPage: loadTemplateRequired(`${ASSET_DIR}/WishPage.png`, 0, 0, 1920, 1080),
    pullOnce: loadTemplateRequired(`${ASSET_DIR}/PullOnce.png`, 1000, 820, 920, 260, 0.88),
    pullTen: loadTemplateRequired(`${ASSET_DIR}/PullTen.png`, 1000, 820, 920, 260, 0.88),
    primogemDialog: loadTemplateRequired(`${ASSET_DIR}/PrimogemExchangeDialog.png`, 450, 200, 1050, 650),
    genesisDialog: loadTemplateRequired(`${ASSET_DIR}/GenesisExchangeDialog.png`, 450, 200, 1050, 650),
    insufficientDialog: loadTemplateRequired(`${ASSET_DIR}/ResourceInsufficientDialog.png`, 450, 200, 1050, 650),
    confirmButton: loadTemplateOptional(`${ASSET_DIR}/ConfirmButton.png`, 900, 650, 450, 250),
    cancelButton: loadTemplateOptional(`${ASSET_DIR}/CancelButton.png`, 550, 650, 450, 250),
    resultClose: loadTemplateRequired(`${ASSET_DIR}/ResultClose.png`, 1700, 0, 220, 160),
    skip: loadTemplateOptional(`${ASSET_DIR}/Skip.png`, 1500, 0, 420, 220),
    banners: loadBannerTemplates()
};

(async function () {
    try {
        trySetGameMetrics();

        const banner = await ensureWishPageReady();
        const policy = RESOURCE_POLICIES[banner];
        log.info(`当前卡池：${banner}，抽卡类型：${PULL_MODE}，资源策略：${policy}`);

        await prePullConfirmLoop(policy);
        await animationLoop();
        await returnToWishPageLoop(banner);

        notifyInfo(`${PULL_MODE}完成，已返回祈愿界面：${banner}`);
    } catch (error) {
        const message = `祈愿抽卡执行失败：${error.message}`;
        log.error(message);
        notifyError(message);
        throw error;
    }
})();

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(String(value || "").replace(/\D/g, ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePullMode(value) {
    return String(value || "").trim() === "十连" ? "十连" : "单抽";
}

function normalizePolicy(value) {
    const policy = String(value || "").trim();
    const valid = [
        "只使用纠缠之缘",
        "使用原石和纠缠之缘",
        "使用创世结晶、原石、纠缠之缘",
        "只使用相遇之缘",
        "使用原石和相遇之缘",
        "使用创世结晶、原石、相遇之缘"
    ];
    return valid.includes(policy) ? policy : "只使用纠缠之缘";
}

function allowsPrimogems(policy) {
    return policy.includes("使用原石") || policy.includes("使用创世结晶");
}

function allowsGenesis(policy) {
    return policy.includes("使用创世结晶");
}

function trySetGameMetrics() {
    try {
        if (typeof setGameMetrics === "function") {
            setGameMetrics(1920, 1080, 1);
        }
    } catch (error) {
        log.warn(`设置游戏度量失败，继续执行：${error.message}`);
    }
}

function loadTemplateRequired(path, x, y, width, height, threshold = 0.95) {
    try {
        const template = RecognitionObject.TemplateMatch(file.ReadImageMatSync(path), x, y, width, height);
        template.Name = path;
        template.Threshold = threshold;
        template.InitTemplate();
        return template;
    } catch (error) {
        throw new Error(`缺少必要识别素材：${path}，${error.message}`);
    }
}

function loadTemplateOptional(path, x, y, width, height, threshold = 0.95) {
    try {
        const template = RecognitionObject.TemplateMatch(file.ReadImageMatSync(path), x, y, width, height);
        template.Name = path;
        template.Threshold = threshold;
        template.InitTemplate();
        return template;
    } catch (error) {
        log.warn(`未加载可选识别素材：${path}`);
        return null;
    }
}

function loadBannerTemplates() {
    const templates = {};
    for (let banner of BANNER_DEFS) {
        templates[banner.key] = loadTemplateRequired(`${ASSET_DIR}/${banner.file}`, 250, 160, 500, 140);
    }
    return templates;
}

async function ensureWishPageReady() {
    if (!await isWishPage()) {
        throw new Error("当前不在祈愿界面。请先运行 WishNavigator 切换到目标卡池");
    }

    const banner = await detectCurrentBanner();
    if (!banner) {
        throw new Error("未能识别当前卡池标签");
    }

    return banner;
}

async function prePullConfirmLoop(policy) {
    const start = Date.now();
    let genesisHandled = false;

    while (Date.now() - start <= 30000) {
        if (await isAnimationStarted()) {
            log.info("已离开祈愿界面，进入抽卡动画阶段");
            return true;
        }

        if (await findTemplate(assets.insufficientDialog, false, 300)) {
            await cancelDisallowedExchange("抽卡资源不足，且没有可继续确认的兑换路径");
        }

        if (await findTemplate(assets.primogemDialog, false, 300)) {
            if (!allowsPrimogems(policy)) {
                await cancelDisallowedExchange("当前资源策略不允许使用原石");
            }

            log.info("检测到原石兑换弹窗，按策略确认");
            await clickDialogConfirm("原石兑换确认按钮");
            await sleep(1200);
            continue;
        }

        if (await findTemplate(assets.genesisDialog, false, 300)) {
            if (!allowsGenesis(policy)) {
                await cancelDisallowedExchange("当前资源策略不允许使用创世结晶");
            }

            if (genesisHandled) {
                throw new Error("创世结晶兑换后再次遇到创世结晶弹窗，可能资源不足或界面异常");
            }

            log.info("检测到创世结晶兑换弹窗，按策略确认后等待回到祈愿页重试");
            await clickDialogConfirm("创世结晶兑换确认按钮");
            genesisHandled = true;
            await waitForWishPageReady(RETURN_TIMEOUT_MS);
            await clickPullButton();
            await sleep(1200);
            continue;
        }

        await clickPullButton();
        await sleep(1200);
    }

    throw new Error("抽卡前确认阶段超时");
}

async function cancelDisallowedExchange(reason) {
    log.warn(`${reason}，点击取消并停止`);
    await clickDialogCancel("兑换取消按钮");
    throw new Error(reason);
}

async function clickDialogConfirm(desc) {
    if (assets.confirmButton && await findAndClick(assets.confirmButton, true, 1500, 100)) {
        return;
    }

    if (!await isAnyExchangeDialogVisible()) {
        throw new Error(`未找到${desc}，且无法确认当前处于兑换弹窗`);
    }

    log.warn(`未识别到${desc}模板，使用兑换弹窗固定坐标兜底点击确认`);
    await click(1160, 760);
}

async function clickDialogCancel(desc) {
    if (assets.cancelButton && await findAndClick(assets.cancelButton, true, 1500, 100)) {
        return;
    }

    if (!await isAnyExchangeDialogVisible()) {
        throw new Error(`未找到${desc}，且无法确认当前处于兑换弹窗`);
    }

    log.warn(`未识别到${desc}模板，使用兑换弹窗固定坐标兜底点击取消`);
    await click(760, 760);
}

async function isAnyExchangeDialogVisible() {
    return await findTemplate(assets.insufficientDialog, false, 100)
        || await findTemplate(assets.primogemDialog, false, 100)
        || await findTemplate(assets.genesisDialog, false, 100);
}

async function clickPullButton() {
    const target = PULL_MODE === "十连" ? assets.pullTen : assets.pullOnce;
    const desc = PULL_MODE === "十连" ? "祈愿10次按钮" : "祈愿1次按钮";
    const clicked = await findAndClick(target, true, 3000, 100);
    if (clicked) {
        return;
    }

    if (!await isWishPage() || !await detectCurrentBanner()) {
        throw new Error(`未找到${desc}，且无法确认当前仍在祈愿页`);
    }

    const fallback = PULL_MODE === "十连"
        ? { x: 1690, y: 1025 }
        : { x: 1320, y: 1025 };

    log.warn(`未识别到${desc}模板，使用祈愿页固定坐标兜底点击 (${fallback.x}, ${fallback.y})`);
    await click(fallback.x, fallback.y);
}

async function animationLoop() {
    await waitForLeaveWishPage(10000);

    if (SKIP_ANIMATION) {
        await trySkipAnimation();
    }

    log.info("等待抽卡结果页关闭按钮出现");
    if (!await waitForResultClose()) {
        throw new Error("抽卡动画阶段超时，未识别到结果页关闭按钮");
    }

    await sleep(RESULT_SETTLE_DELAY_MS);
}

async function trySkipAnimation() {
    if (!assets.skip) {
        log.warn("已开启跳过动画，但缺少 Skip.png，跳过本次跳过尝试");
        return;
    }

    await sleep(1700);
    await click(960, 540);
    await sleep(300);

    if (assets.skip && await findAndClick(assets.skip, true, 3000, 100)) {
        log.info("已点击跳过按钮");
    } else {
        log.warn("未识别到跳过按钮模板，使用右上角固定坐标兜底点击跳过");
        await click(1785, 55);
    }
}

async function returnToWishPageLoop(expectedBanner) {
    log.info("点击结果页关闭按钮，返回祈愿页");
    await clickResultClose();

    const returned = await waitForCondition(async function () {
        if (!await isWishPage()) {
            return false;
        }

        const banner = await detectCurrentBanner();
        return banner === expectedBanner;
    }, RETURN_TIMEOUT_MS, 500);

    if (!returned) {
        throw new Error("点击结果页关闭按钮后，未能确认返回原卡池祈愿页");
    }
}

async function waitForResultClose() {
    return findAndClick(assets.resultClose, false, ANIMATION_TIMEOUT_MS, 300);
}

async function clickResultClose() {
    if (await findAndClick(assets.resultClose, true, 2000, 100)) {
        return;
    }

    if (await isWishPage()) {
        throw new Error("准备关闭结果页时已检测到祈愿页，未执行结果页关闭坐标兜底");
    }

    log.warn("未识别到结果页关闭按钮模板，使用右上角固定坐标兜底点击关闭");
    await click(1845, 50);
}

async function waitForWishPageReady(timeoutMs) {
    const ok = await waitForCondition(async function () {
        return await isWishPage() && !!await detectCurrentBanner();
    }, timeoutMs, 500);

    if (!ok) {
        throw new Error("未能等待回到祈愿页");
    }
}

async function waitForLeaveWishPage(timeoutMs) {
    const ok = await waitForCondition(async function () {
        return !await isWishPage();
    }, timeoutMs, 300);

    if (!ok) {
        throw new Error("点击抽卡后未检测到离开祈愿页");
    }
}

async function isAnimationStarted() {
    return !await isWishPage();
}

async function isWishPage() {
    return findTemplate(assets.wishPage, false, 200);
}

async function detectCurrentBanner() {
    const ocrBanner = detectBannerByOcr();
    if (ocrBanner) {
        return ocrBanner;
    }

    for (let banner of BANNER_DEFS) {
        const template = assets.banners[banner.key];
        if (template && await findTemplate(template, false, 100)) {
            return banner.key;
        }
    }

    return null;
}

function detectBannerByOcr() {
    const text = readOcrText(RecognitionObject.Ocr(250, 160, 500, 140));
    if (!text) {
        return null;
    }

    log.info(`卡池标签 OCR：${text}`);

    if (text.includes("角色活动祈愿-2") || text.includes("角色活动祈愿2")) {
        return "角色活动祈愿-2";
    }
    if (text.includes("武器活动祈愿")) {
        return "武器活动祈愿";
    }
    if (text.includes("常驻祈愿")) {
        return "常驻祈愿";
    }
    if (text.includes("角色活动祈愿")) {
        return "角色活动祈愿";
    }

    let best = { key: null, score: 0 };
    for (let banner of BANNER_DEFS) {
        for (let targetText of banner.ocrTexts) {
            const score = textSimilarity(text, normalizeText(targetText));
            if (score > best.score) {
                best = { key: banner.key, score };
            }
        }
    }

    return best.score >= 0.86 ? best.key : null;
}

async function clickRequired(target, desc) {
    const clicked = await findAndClick(target, true, 5000, 100);
    if (!clicked) {
        throw new Error(`未找到${desc}`);
    }
}

async function findAndClick(target, doClick = true, timeout = 3000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start <= timeout) {
        if (await findTemplate(target, doClick, interval)) {
            return true;
        }
        await sleep(interval);
    }
    return false;
}

async function findTemplate(target, doClick = false, postClickDelay = 50) {
    let region = null;
    try {
        region = captureGameRegion();
        const result = region.find(target);
        if (resultExists(result)) {
            if (doClick) {
                await result.click();
                await sleep(postClickDelay);
            }
            return true;
        }
        return false;
    } catch (error) {
        log.warn(`模板识别失败：${target && target.Name ? target.Name : "unknown"}，${error.message}`);
        return false;
    } finally {
        if (region) {
            region.dispose();
        }
    }
}

function resultExists(result) {
    if (!result) return false;
    if (typeof result.isExist === "function") return result.isExist();
    if (typeof result.isEmpty === "function") return !result.isEmpty();
    return false;
}

async function waitForCondition(check, timeoutMs, intervalMs) {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
        if (await check()) {
            return true;
        }
        await sleep(intervalMs);
    }
    return false;
}

function readOcrText(ocrObject) {
    let region = null;
    try {
        region = captureGameRegion();
        const results = region.findMulti(ocrObject);
        const combined = [];

        for (let i = 0; i < results.count; i++) {
            const text = normalizeText(results[i].text);
            if (!text) continue;
            combined.push(text);
        }

        return combined.join("");
    } catch (error) {
        log.warn(`OCR 识别失败：${error.message}`);
        return "";
    } finally {
        if (region) {
            region.dispose();
        }
    }
}

function normalizeText(text) {
    return String(text || "").replace(/\s+/g, "");
}

function textSimilarity(actual, target) {
    actual = normalizeText(actual);
    target = normalizeText(target);

    if (!actual || !target) return 0;
    if (actual.includes(target) || target.includes(actual)) return 1;

    let best = 1 - levenshteinDistance(actual, target) / Math.max(actual.length, target.length);
    if (actual.length > target.length) {
        for (let i = 0; i <= actual.length - target.length; i++) {
            const part = actual.substring(i, i + target.length);
            best = Math.max(best, 1 - levenshteinDistance(part, target) / target.length);
        }
    }
    return best;
}

function levenshteinDistance(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let i = 0; i < rows; i++) dp[i][0] = i;
    for (let j = 0; j < cols; j++) dp[0][j] = j;

    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }

    return dp[a.length][b.length];
}

function notifyInfo(message) {
    log.info(message);
    try {
        if (notification.Send) {
            notification.Send(message);
        } else if (notification.send) {
            notification.send(message);
        }
    } catch (error) {
        log.warn(`发送通知失败：${error.message}`);
    }
}

function notifyError(message) {
    try {
        notification.error(message);
    } catch (error) {
        log.warn(`发送错误通知失败：${error.message}`);
    }
}
