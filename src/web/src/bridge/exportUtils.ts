import { fs, pathUtil } from "@/bridge/fs";
import { invoke, isTauri } from "@/bridge/ipc";
import { renderMarkdown } from "@/components/editor/preview";
import { useUi } from "@/stores/ui";

/**
 * 将 HTML 渲染为 PNG Blob（基于 SVG foreignObject 原生离屏渲染）。
 */
export async function htmlToPngBlob(html: string, width = 860): Promise<Blob> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = `${width}px`;
  container.style.visibility = "hidden";
  container.innerHTML = html;
  document.body.appendChild(container);

  // 等待图片与字体加载就绪
  const imgs = Array.from(container.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) resolve();
          else {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }
        }),
    ),
  );

  const height = Math.max(container.scrollHeight, 400);
  document.body.removeChild(container);

  const svgData = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="background:#ffffff;color:#1f2328;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:32px;box-sizing:border-box;">
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; }
            h1, h2, h3, h4, h5, h6 { color: #0f172a; margin-top: 1.4em; margin-bottom: 0.6em; line-height: 1.3; }
            h1 { font-size: 26px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
            h2 { font-size: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
            h3 { font-size: 16px; }
            p, ul, ol, blockquote { margin-top: 0.8em; margin-bottom: 0.8em; line-height: 1.7; }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 85%; background: #f1f5f9; padding: 2px 5px; border-radius: 4px; }
            pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; overflow: auto; }
            pre code { background: transparent; padding: 0; font-size: 13px; }
            blockquote { border-left: 4px solid #cbd5e1; margin-left: 0; padding-left: 14px; color: #64748b; }
            table { border-collapse: collapse; width: 100%; margin: 16px 0; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
            th { background: #f8fafc; font-weight: 600; }
            tr:nth-child(even) { background: #f8fafc; }
            img { max-width: 100%; height: auto; border-radius: 6px; }
            hr { border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0; }
          </style>
          ${html}
        </div>
      </foreignObject>
    </svg>
  `;

  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2; // 2x 高清视网膜分辨率
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("创建 Canvas 绘图上下文失败"));
        return;
      }
      ctx.scale(2, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas 导出 PNG 失败"));
      }, "image/png");
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(new Error("图片渲染失败"));
    };
    img.src = url;
  });
}

/**
 * 导出长图并提示，附带「打开所在文件夹」按钮。
 */
export async function exportMarkdownAsImage(name: string, md: string) {
  const ui = useUi.getState();
  ui.toast("正在生成长图…", "info");

  try {
    const bodyHtml = renderMarkdown(md);
    const blob = await htmlToPngBlob(bodyHtml, 860);

    if (isTauri()) {
      // 桌面端通过系统保存对话框选择导出位置
      const res = await invoke<{ canceled: boolean; filePath: string | null }>(
        "dialog.showSaveDialog",
        {
          title: "导出长图",
          defaultPath: `${name}.png`,
          filters: [{ name: "PNG 图像 (*.png)", extensions: ["png"] }],
        },
      ).catch(() => null);

      if (res?.canceled || !res?.filePath) {
        return;
      }

      const savePath = res.filePath;
      const buffer = await blob.arrayBuffer();
      // 使用 base64 写入磁盘
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = `data:image/png;base64,${btoa(binary)}`;

      await invoke("images.savePNG", {
        path: savePath,
        data: base64Data,
        name,
      });

      if (ui.prefs.exportOpenFolder !== false) {
        void fs.showInFolder(savePath);
      }
      // 成功提示并提供「打开所在文件夹」按钮
      ui.toast(`已导出图片：${pathUtil.name(savePath)}`, "success", {
        label: "打开所在文件夹",
        run: () => fs.showInFolder(savePath),
      });
    } else {
      // 浏览器端下载
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ui.toast(`已导出图片：${name}.png`, "success");
    }
  } catch (err) {
    ui.toast(`导出长图失败：${String(err)}`, "danger");
  }
}

/**
 * 导出 HTML 并提示，附带「打开所在文件夹」按钮。
 */
export async function exportMarkdownAsHtml(
  name: string,
  md: string,
  styled = true,
) {
  const ui = useUi.getState();
  const body = renderMarkdown(md);
  const html = styled
    ? `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:860px;margin:40px auto;padding:0 24px;line-height:1.7;color:#1f2328;background:#fff;}pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow:auto}code{font-family:ui-monospace,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d7de;padding:8px 12px}blockquote{border-left:3px solid #d0d7de;margin:0;padding-left:16px;color:#59636e}img{max-width:100%}</style></head><body>${body}</body></html>`
    : `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body>${body}</body></html>`;

  if (isTauri()) {
    const res = await invoke<{ canceled: boolean; filePath: string | null }>(
      "dialog.showSaveDialog",
      {
        title: "导出 HTML",
        defaultPath: `${name}.html`,
        filters: [{ name: "HTML 文档 (*.html)", extensions: ["html"] }],
      },
    ).catch(() => null);

    if (res?.canceled || !res?.filePath) return;
    const savePath = res.filePath;
    await fs.writeFile(savePath, html);
    if (ui.prefs.exportOpenFolder !== false) {
      void fs.showInFolder(savePath);
    }
    ui.toast(`已导出 HTML：${pathUtil.name(savePath)}`, "success", {
      label: "打开所在文件夹",
      run: () => fs.showInFolder(savePath),
    });
  } else {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.toast(`已导出 HTML：${name}.html`, "success");
  }
}
