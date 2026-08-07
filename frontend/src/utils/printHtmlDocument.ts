export interface PrintHtmlDocumentOptions {
  html: string;
  title?: string;
  afterPrintFallbackMs?: number;
  resourceLoadTimeoutMs?: number;
}

let printJobQueue: Promise<void> = Promise.resolve();

function waitForDocumentReady(doc: Document): Promise<void> {
  return new Promise((resolve) => {
    if (doc.readyState === "complete") {
      resolve();
      return;
    }

    const finish = () => {
      doc.removeEventListener("readystatechange", handleReadyStateChange);
      if (typeof doc.defaultView !== "undefined") {
        doc.defaultView?.removeEventListener("load", finish);
      }
      resolve();
    };

    const handleReadyStateChange = () => {
      if (doc.readyState === "complete") {
        finish();
      }
    };

    doc.addEventListener("readystatechange", handleReadyStateChange);
    doc.defaultView?.addEventListener("load", finish, { once: true });
  });
}

function waitForIframeResources(doc: Document, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.setTimeout(resolve, 50);
    };

    const pendingImages = Array.from(doc.images).filter((img) => !img.complete);

    const imagePromises = pendingImages.map(
      (img) =>
        new Promise<void>((imageResolve) => {
          const finish = () => imageResolve();
          img.addEventListener("load", finish, { once: true });
          img.addEventListener("error", finish, { once: true });
        })
    );

    const fontsReady =
      "fonts" in doc && doc.fonts
        ? doc.fonts.ready.catch(() => undefined)
        : Promise.resolve();

    const timeoutId = window.setTimeout(finish, timeoutMs);

    void Promise.allSettled([waitForDocumentReady(doc), ...imagePromises, fontsReady]).then(() => {
      if ("requestAnimationFrame" in window) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(finish);
        });
        return;
      }

      finish();
    });
  });
}

export function printHtmlDocument({
  html,
  title,
  afterPrintFallbackMs = 10000,
  resourceLoadTimeoutMs = 10000,
}: PrintHtmlDocumentOptions): Promise<void> {
  const runPrintJob = () =>
    new Promise<void>((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";

      let settled = false;
      let fallbackTimer: number | null = null;
      let mediaQueryList: MediaQueryList | null = null;
      let mediaQueryCleanup: (() => void) | null = null;
      let printStarted = false;

      const cleanup = () => {
        if (fallbackTimer !== null) {
          window.clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }

        if (mediaQueryCleanup) {
          mediaQueryCleanup();
          mediaQueryCleanup = null;
        }

        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error("Failed to print document"));
      };

      document.body.appendChild(iframe);

      const printWindow = iframe.contentWindow;
      const printDocument = iframe.contentDocument;
      if (!printWindow || !printDocument) {
        fail(new Error("Unable to access print iframe"));
        return;
      }

      printDocument.open();
      printDocument.write(html);
      printDocument.close();

      if (title) {
        try {
          if (iframe.contentDocument) {
            iframe.contentDocument.title = title;
          }
        } catch {
          // Best effort only; printing can continue without a custom title.
        }
      }

      window.setTimeout(() => {
        void waitForIframeResources(printDocument, resourceLoadTimeoutMs)
          .then(() => {
            const handleAfterPrint = () => {
              printWindow.removeEventListener("afterprint", handleAfterPrint);
              finish();
            };

            printWindow.addEventListener("afterprint", handleAfterPrint);

            if ("matchMedia" in printWindow) {
              mediaQueryList = printWindow.matchMedia("print");

              const handlePrintMediaChange = (event: MediaQueryListEvent) => {
                if (printStarted && !event.matches) {
                  finish();
                }
              };

              if ("addEventListener" in mediaQueryList) {
                mediaQueryList.addEventListener("change", handlePrintMediaChange);
                mediaQueryCleanup = () => {
                  mediaQueryList?.removeEventListener("change", handlePrintMediaChange);
                };
              } else if ("addListener" in mediaQueryList) {
                mediaQueryList.addListener(handlePrintMediaChange);
                mediaQueryCleanup = () => {
                  mediaQueryList?.removeListener(handlePrintMediaChange);
                };
              }
            }

            fallbackTimer = window.setTimeout(() => {
              printWindow.removeEventListener("afterprint", handleAfterPrint);
              finish();
            }, afterPrintFallbackMs);

            printWindow.focus();
            printStarted = true;
            printWindow.print();
          })
          .catch(fail);
      }, 0);
    });

  const queuedJob = printJobQueue.catch(() => undefined).then(runPrintJob);
  printJobQueue = queuedJob.then(() => undefined, () => undefined);
  return queuedJob;
}
