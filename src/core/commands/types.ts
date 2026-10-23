import { DiagramDocument } from '../diagram/types';

export interface Command {
  readonly id: string;
  readonly description: string;
  readonly documentChangeKind?: 'replacement';
  execute(document: DiagramDocument): DiagramDocument;
  undo(document: DiagramDocument): DiagramDocument;
}
