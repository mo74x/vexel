import * as React from 'react';
import { FileText, Mic, Sparkles } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export interface TranscriptViewerProps {
  transcript?: string | null;
  extractedData?: Record<string, unknown> | null;
  labels: {
    title: string;
    subtitle: string;
    empty: string;
    highlightHint: string;
  };
}

export function TranscriptViewer({
  transcript,
  extractedData,
  labels,
}: TranscriptViewerProps) {
  if (!transcript) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            <span>{labels.title}</span>
          </CardTitle>
          <CardDescription className="text-xs">{labels.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic">{labels.empty}</p>
        </CardContent>
      </Card>
    );
  }

  // Extract phrases to highlight from extractedData values (strings, numbers)
  const highlightPhrases: string[] = React.useMemo(() => {
    if (!extractedData) return [];
    const phrases: string[] = [];

    const traverse = (val: unknown) => {
      if (typeof val === 'string' && val.length > 2) {
        phrases.push(val);
      } else if (typeof val === 'number') {
        phrases.push(String(val));
      } else if (typeof val === 'object' && val !== null) {
        Object.values(val).forEach(traverse);
      }
    };

    Object.values(extractedData).forEach(traverse);
    // Sort longer phrases first to prevent partial clobbering
    return Array.from(new Set(phrases)).sort((a, b) => b.length - a.length);
  }, [extractedData]);

  // Highlight phrases in transcript if any match
  const renderedContent = React.useMemo(() => {
    if (highlightPhrases.length === 0) {
      return <span>{transcript}</span>;
    }

    // Escape regex characters
    const escaped = highlightPhrases.map((p) =>
      p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = transcript.split(regex);

    return parts.map((part, i) => {
      const isMatch = highlightPhrases.some(
        (p) => p.toLowerCase() === part.toLowerCase(),
      );

      if (isMatch) {
        return (
          <mark
            key={i}
            className="rounded bg-brand-500/20 px-1 py-0.5 font-semibold text-brand-900 dark:text-brand-200 decoration-clone"
            title="Extracted Deal Property"
          >
            {part}
          </mark>
        );
      }
      return <span key={i}>{part}</span>;
    });
  }, [transcript, highlightPhrases]);

  return (
    <Card className="h-full flex flex-col" data-testid="transcript-viewer">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            <span>{labels.title}</span>
          </CardTitle>
          {highlightPhrases.length > 0 && (
            <div className="flex items-center gap-1 text-[11px] font-medium text-brand-600 dark:text-brand-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI Extracted</span>
            </div>
          )}
        </div>
        <CardDescription className="text-xs">{labels.subtitle}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col justify-between space-y-4">
        {/* Bilingual Transcript Body */}
        <div className="rounded-lg border border-border/80 bg-muted/20 p-4 font-sans text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {renderedContent}
        </div>

        {highlightPhrases.length > 0 && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-2 border-t border-border/60">
            <span className="inline-block h-2 w-2 rounded-full bg-brand-500" />
            <span>{labels.highlightHint}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

