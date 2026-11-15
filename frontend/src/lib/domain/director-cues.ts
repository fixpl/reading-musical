export type DirectorCue = {
  id: string;
  row: number;
  number: string;
  section: string;
  startMs: number | null;
  note: string;
  actions: Array<{ track: string; content: string }>;
};

export type CueMatch = DirectorCue & {
  status: "candidate" | "review";
  sceneId: string | null;
  reason: string;
  scriptEvidence: string | null;
};

export type CueReview = {
  matches: CueMatch[];
  scenes: Array<{ id: string; actIndex: number; sceneIndex: number; title: string }>;
  warning: string | null;
};
