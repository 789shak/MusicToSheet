import React from 'react';

export interface NoteEvent {
  pitch: string;
  start: number;
  duration: number;
}

export interface SheetMusicMeta {
  bpm?: number;
  trackName?: string;
  instrument?: string;
  format?: string;
  [key: string]: any;
}

export function buildStaticPdfHtml(notes: NoteEvent[], meta?: SheetMusicMeta): string;
export function buildScreenHtml(notes: NoteEvent[], meta?: SheetMusicMeta): string;

export interface SheetMusicViewerProps {
  notes?: { pitch: string; start: number; duration: number }[];
  previewHtml?: string | null;
  musicxml?: string | null;
  bpm?: number;
  onMessage?: (event: any) => void;
}

declare const SheetMusicViewer: React.ForwardRefExoticComponent<
  SheetMusicViewerProps & React.RefAttributes<any>
>;

export default SheetMusicViewer;
