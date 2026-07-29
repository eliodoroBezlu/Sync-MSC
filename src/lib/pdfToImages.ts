import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const ESCALA_RENDER = 2;

function dataUrlABytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// Renderiza cada página de un PDF (recibido como data URL) a una imagen JPEG,
// para poder incrustarlo visualmente en el informe igual que una foto.
export async function renderizarPaginasPdf(dataUrl: string): Promise<string[]> {
  const loadingTask = getDocument({ data: dataUrlABytes(dataUrl) });
  const pdf = await loadingTask.promise;
  const paginas: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: ESCALA_RENDER });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      paginas.push(canvas.toDataURL("image/jpeg", 0.85));
    }
  } finally {
    await loadingTask.destroy();
  }
  return paginas;
}
