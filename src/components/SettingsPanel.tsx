import { useState } from "react";
import { AppSettings } from "../types";
import "./SettingsPanel.css";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

export default function SettingsPanel({ settings, onSave, onClose }: Props) {
  const [local, setLocal] = useState<AppSettings>({ ...settings });

  const update = (key: keyof AppSettings, value: number | string) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(local);
    onClose();
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-title">外观设置</h2>

      <div className="setting-group">
        <label>字体大小</label>
        <div className="setting-row">
          <input
            type="range"
            min={14}
            max={48}
            value={local.fontSize}
            onChange={(e) => update("fontSize", Number(e.target.value))}
          />
          <span className="setting-val">{local.fontSize}px</span>
        </div>
      </div>

      <div className="setting-group">
        <label>字体</label>
        <select
          value={local.fontFamily}
          onChange={(e) => update("fontFamily", e.target.value)}
        >
          <option value="Microsoft YaHei, sans-serif">微软雅黑</option>
          <option value="PingFang SC, Microsoft YaHei, sans-serif">苹方</option>
          <option value="SimSun, serif">宋体</option>
          <option value="KaiTi, serif">楷体</option>
          <option value="'Courier New', monospace">等宽</option>
        </select>
      </div>

      <div className="setting-group">
        <label>文字颜色</label>
        <div className="setting-row">
          <input
            type="color"
            value={local.textColor}
            onChange={(e) => update("textColor", e.target.value)}
          />
          <span className="setting-val">{local.textColor}</span>
        </div>
      </div>

      <div className="setting-group">
        <label>高亮颜色</label>
        <div className="setting-row">
          <input
            type="color"
            value={local.highlightColor}
            onChange={(e) => update("highlightColor", e.target.value)}
          />
          <span className="setting-val">{local.highlightColor}</span>
        </div>
      </div>

      <div className="setting-group">
        <label>背景不透明度</label>
        <div className="setting-row">
          <input
            type="range"
            min={0}
            max={80}
            value={Math.round(local.bgOpacity * 100)}
            onChange={(e) => update("bgOpacity", Number(e.target.value) / 100)}
          />
          <span className="setting-val">{Math.round(local.bgOpacity * 100)}%</span>
        </div>
      </div>

      <div className="setting-group">
        <label>背景模糊</label>
        <div className="setting-row">
          <input
            type="range"
            min={0}
            max={30}
            value={local.bgBlur}
            onChange={(e) => update("bgBlur", Number(e.target.value))}
          />
          <span className="setting-val">{local.bgBlur}px</span>
        </div>
      </div>

      {/* Preview */}
      <div
        className="setting-preview"
        style={{
          fontFamily: local.fontFamily,
          fontSize: local.fontSize,
          color: local.textColor,
        }}
      >
        <span style={{ opacity: 0.4 }}>已唱过的歌词</span>
        <br />
        <span style={{ color: local.highlightColor, fontWeight: 700 }}>
          当前高亮歌词 ✨
        </span>
        <br />
        <span style={{ opacity: 0.3 }}>即将到来的歌词</span>
      </div>

      <div className="setting-actions">
        <button className="btn-cancel" onClick={onClose}>
          取消
        </button>
        <button className="btn-save" onClick={handleSave}>
          保存
        </button>
      </div>
    </div>
  );
}
