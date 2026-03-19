'use client';

import { useRef, useState, useCallback } from 'react';
import { Download } from 'lucide-react';

interface ChartExportWrapperProps {
  children: React.ReactNode;
  /** Base filename (without extension). Defaults to "vibecheck-chart". */
  filename?: string;
  /** Whether the wrapped chart is SVG-based (enables SVG export option). */
  svgBased?: boolean;
  className?: string;
}

/**
 * Wraps any chart component and adds a download button in the top-right corner.
 *
 * - Captures the chart container as a PNG using html2canvas.
 * - If `svgBased` is true, also offers SVG export by extracting the SVG innerHTML.
 */
export function ChartExportWrapper({
  children,
  filename = 'vibecheck-chart',
  svgBased = false,
  className = '',
}: ChartExportWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const dateStamp = new Date().toISOString().slice(0, 10);
  const baseName = `${filename}-${dateStamp}`;

  const exportPng = useCallback(async () => {
    if (!containerRef.current || exporting) return;
    setExporting(true);
    setShowMenu(false);

    try {
      // Dynamic import to keep bundle size down on pages that don't use export
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(containerRef.current, {
        backgroundColor: null,
        scale: 2, // Higher resolution
        logging: false,
      });

      const link = document.createElement('a');
      link.download = `${baseName}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Failed to export chart as PNG:', err);
    } finally {
      setExporting(false);
    }
  }, [baseName, exporting]);

  const exportSvg = useCallback(() => {
    if (!containerRef.current) return;
    setShowMenu(false);

    const svgElement = containerRef.current.querySelector('svg');
    if (!svgElement) {
      console.warn('No SVG element found in chart container');
      return;
    }

    const svgClone = svgElement.cloneNode(true) as SVGElement;

    // Ensure the SVG has proper namespace and dimensions
    if (!svgClone.getAttribute('xmlns')) {
      svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!svgClone.getAttribute('width')) {
      svgClone.setAttribute('width', String(svgElement.getBoundingClientRect().width));
    }
    if (!svgClone.getAttribute('height')) {
      svgClone.setAttribute('height', String(svgElement.getBoundingClientRect().height));
    }

    const svgData = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = `${baseName}.svg`;
    link.href = url;
    link.click();

    URL.revokeObjectURL(url);
  }, [baseName]);

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef}>{children}</div>

      <div className="absolute top-2 right-2 z-10">
        {svgBased ? (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              disabled={exporting}
              className="flex items-center justify-center w-8 h-8 rounded-md bg-background/80 border border-border shadow-sm hover:bg-accent transition-colors disabled:opacity-50"
              title="Export chart"
              aria-label="Export chart"
            >
              <Download className="h-4 w-4 text-muted-foreground" />
            </button>

            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
                <button
                  onClick={exportPng}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  Download PNG
                </button>
                <button
                  onClick={exportSvg}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  Download SVG
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={exportPng}
            disabled={exporting}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-background/80 border border-border shadow-sm hover:bg-accent transition-colors disabled:opacity-50"
            title="Download as PNG"
            aria-label="Download chart as PNG"
          >
            <Download className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}
