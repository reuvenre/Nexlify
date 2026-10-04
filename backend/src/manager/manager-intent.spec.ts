import { managerQuestion } from './manager-intent';

describe('managerQuestion', () => {
  it('keeps plain product searches as searches', () => {
    for (const s of ['אוזניות בלוטות\'', 'robot vacuum', 'חגורה טקטית', 'מנורת לילה לילדים', '/search watch', '/status']) {
      expect(managerQuestion(s)).toBeNull();
    }
  });

  it('routes questions to the manager', () => {
    expect(managerQuestion('למה פינטרסט ירד השבוע')).toBe('למה פינטרסט ירד השבוע');
    expect(managerQuestion('תסביר לי את ההרצה האחרונה של פינטרסט')).not.toBeNull();
    expect(managerQuestion('בוקר אור תסביר לי את ההרצה האחרונה')).not.toBeNull();
    expect(managerQuestion('כמה קליקים היו אתמול')).not.toBeNull();
    expect(managerQuestion('פינטרסט עובד?')).toBe('פינטרסט עובד?');
  });

  it('takes the text after /ask, and nothing for an empty /ask', () => {
    expect(managerQuestion('/ask מה המצב')).toBe('מה המצב');
    expect(managerQuestion('/ask@NexlifyBot מה המצב')).toBe('מה המצב');
    expect(managerQuestion('/ask')).toBeNull();
  });

  it('does not treat a single opener word as a question', () => {
    expect(managerQuestion('מה')).toBeNull();
  });
});
