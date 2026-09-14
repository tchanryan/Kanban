export class EditConflictError extends Error {
  constructor() {
    super(
      'This field changed in another tab or during a restore. Review the saved version before replacing it.',
    );
    this.name = 'EditConflictError';
  }
}
