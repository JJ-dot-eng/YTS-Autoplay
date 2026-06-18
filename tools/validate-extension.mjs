import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const errors = [];

function addError(message) {
  errors.push(message);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    addError(`${path.relative(repoRoot, filePath)} JSON을 읽을 수 없습니다: ${error.message}`);
    return null;
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function checkJavaScript(relativePath) {
  if (!fileExists(relativePath)) {
    addError(`참조하는 ${relativePath} 파일이 없습니다.`);
    return;
  }

  const check = spawnSync(process.execPath, ["--check", path.join(repoRoot, relativePath)], {
    encoding: "utf8"
  });

  if (check.status !== 0) {
    addError(`${relativePath} 문법 검사 실패:\n${check.stderr || check.stdout}`);
  }
}

function checkLocaleMessages(locale) {
  const messagesPath = path.join(repoRoot, "_locales", locale, "messages.json");
  const messages = readJson(messagesPath);

  if (!messages) return null;

  for (const key of [
    "extensionName",
    "extensionShortName",
    "extensionDescription",
    "htmlLang",
    "popupSubtitle",
    "toggleLabel",
    "statusOn",
    "statusOff"
  ]) {
    if (!messages[key]?.message || typeof messages[key].message !== "string") {
      addError(`_locales/${locale}/messages.json에 ${key}.message가 필요합니다.`);
    }
  }

  return messages;
}

function getPngSize(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const buffer = fs.readFileSync(filePath);
  const pngSignature = "89504e470d0a1a0a";

  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

const manifest = readJson(manifestPath);

if (manifest) {
  if (manifest.manifest_version !== 3) {
    addError("manifest_version은 3이어야 합니다.");
  }

  if (manifest.default_locale !== "en") {
    addError("default_locale은 en이어야 합니다.");
  }

  const enMessages = checkLocaleMessages("en");
  const koMessages = checkLocaleMessages("ko");

  if (!manifest.name || manifest.name !== "__MSG_extensionName__") {
    addError("manifest.name은 __MSG_extensionName__을 사용해야 합니다.");
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    addError("manifest.version이 필요합니다.");
  }

  if (manifest.description !== "__MSG_extensionDescription__") {
    addError("manifest.description은 __MSG_extensionDescription__을 사용해야 합니다.");
  }

  for (const [locale, messages] of [["en", enMessages], ["ko", koMessages]]) {
    const description = messages?.extensionDescription?.message;

    if (description && description.length > 132) {
      addError(`_locales/${locale} extensionDescription은 132자 이하여야 합니다.`);
    }
  }

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const allowedPermissions = ["storage", "scripting", "webNavigation"];
  const unexpectedPermissions = permissions.filter((permission) => !allowedPermissions.includes(permission));
  if (unexpectedPermissions.length > 0) {
    addError(`허용되지 않은 권한이 있습니다: ${unexpectedPermissions.join(", ")}`);
  }

  if (!permissions.includes("storage")) {
    addError("popup 설정 저장을 위해 storage 권한이 필요합니다.");
  }

  if (!permissions.includes("scripting")) {
    addError("이미 열려 있는 YouTube 탭에 content script를 주입하기 위해 scripting 권한이 필요합니다.");
  }

  if (!permissions.includes("webNavigation")) {
    addError("YouTube 내부 이동 감지를 위해 webNavigation 권한이 필요합니다.");
  }

  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  if (hostPermissions.length !== 1 || hostPermissions[0] !== "https://www.youtube.com/*") {
    addError("host_permissions는 https://www.youtube.com/* 하나만 사용해야 합니다.");
  }

  const contentScripts = manifest.content_scripts || [];
  const matches = contentScripts.flatMap((script) => script.matches || []);
  if (matches.length !== 1 || matches[0] !== "https://www.youtube.com/*") {
    addError("content script는 https://www.youtube.com/* 에서 실행되어야 합니다.");
  }

  for (const script of contentScripts) {
    for (const jsFile of script.js || []) {
      checkJavaScript(jsFile);
    }
  }

  if (manifest.background?.service_worker !== "background.js") {
    addError("manifest.background.service_worker는 background.js여야 합니다.");
  }

  checkJavaScript("background.js");

  const popupPath = manifest.action?.default_popup;
  if (!popupPath) {
    addError("manifest.action.default_popup이 필요합니다.");
  } else if (!fileExists(popupPath)) {
    addError(`popup 파일이 없습니다: ${popupPath}`);
  }

  checkJavaScript("popup.js");

  const requiredIconSizes = ["16", "32", "48", "128"];
  for (const size of requiredIconSizes) {
    const iconPath = manifest.icons?.[size];

    if (!iconPath) {
      addError(`manifest.icons.${size} 항목이 필요합니다.`);
      continue;
    }

    if (!fileExists(iconPath)) {
      addError(`아이콘 파일이 없습니다: ${iconPath}`);
      continue;
    }

    const iconSize = getPngSize(iconPath);
    if (!iconSize) {
      addError(`아이콘은 PNG 파일이어야 합니다: ${iconPath}`);
      continue;
    }

    const expectedSize = Number(size);
    if (iconSize.width !== expectedSize || iconSize.height !== expectedSize) {
      addError(`${iconPath} 크기는 ${expectedSize}x${expectedSize}이어야 합니다.`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("extension validation ok");
