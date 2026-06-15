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

  if (!manifest.name || typeof manifest.name !== "string") {
    addError("manifest.name이 필요합니다.");
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    addError("manifest.version이 필요합니다.");
  }

  if (!manifest.description || typeof manifest.description !== "string") {
    addError("manifest.description이 필요합니다.");
  } else if (manifest.description.length > 132) {
    addError("manifest.description은 Chrome Web Store 기준에 맞게 132자 이하여야 합니다.");
  }

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const unexpectedPermissions = permissions.filter((permission) => permission !== "storage");
  if (unexpectedPermissions.length > 0) {
    addError(`허용되지 않은 권한이 있습니다: ${unexpectedPermissions.join(", ")}`);
  }

  if (!permissions.includes("storage")) {
    addError("popup 설정 저장을 위해 storage 권한이 필요합니다.");
  }

  if (Array.isArray(manifest.host_permissions) && manifest.host_permissions.length > 0) {
    addError("현재 기능에는 host_permissions가 필요하지 않습니다.");
  }

  const contentScripts = manifest.content_scripts || [];
  const matches = contentScripts.flatMap((script) => script.matches || []);
  if (matches.length !== 1 || matches[0] !== "https://www.youtube.com/shorts/*") {
    addError("content script는 https://www.youtube.com/shorts/* 에서만 실행되어야 합니다.");
  }

  for (const script of contentScripts) {
    for (const jsFile of script.js || []) {
      checkJavaScript(jsFile);
    }
  }

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
