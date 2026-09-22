import { googleAccessToken } from './_integrations.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/* Which document a subject's test calls for. Mr. Ko runs two pipelines:
   science students revise from a study guide, math students from an
   isomorphic practice test. Nothing else is sent, and answer keys are
   never sent to a student. */
export function materialKind(subject) {
  return subject === 'Math' ? 'Practice Test' : 'Study Guide';
}

/* Geometry alone runs two test formats, and the desktop build queue will
   not start until it knows which: the BJU chapter test, or six chapter
   theorems demonstrated on the board. The choice belongs to the student
   because it is their test, so it is asked on the proposal. */
export const GEOMETRY_MODES = ['bju', 'proofs'];

export function isGeometry(subject, course) {
  return subject === 'Math' && /geometry/i.test(String(course || ''));
}

export function geometryModeLabel(mode) {
  if (mode === 'bju') return 'BJU chapter test';
  if (mode === 'proofs') return 'Six demonstrated chapter proofs';
  return '';
}

/* Drive holds these titles in two hands. Written by a person they read
   'Ch01 Study Guide - Chemistry (5th ed.)'; written by the LaTeX build
   they read 'Ch13_Practice_Test__Algebra_1_3rd_ed_.pdf'. Drop everything
   that is not a letter or a digit and the two collapse onto the same key,
   so one comparison covers both conventions and neither has to change. */
function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/* 'Ch.01', 'Chapter 1' and '1' all mean the same chapter. Drive's own
   titles are already zero-padded to two digits, so pad to match. */
export function chapterKey(chapter) {
  const m = String(chapter || '').match(/\d+/);
  return m ? 'ch' + String(Number(m[0])).padStart(2, '0') : '';
}

function stripExtension(name) {
  return String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

export function materialKey(chapter, kind, course) {
  const ch = chapterKey(chapter);
  return ch ? ch + slug(kind) + slug(course) : '';
}

const MATERIALS_ROOT =
  process.env.MATERIALS_FOLDER_ID || '1CodcVoCA6slGkxFf06UHU5C13PZwXVw4';

async function driveList(q, token) {
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType)',
    pageSize: '200',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const r = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
    headers: { authorization: 'Bearer ' + token },
  });
  if (!r.ok) {
    throw new Error('drive list ' + r.status + ': ' + (await r.text()).slice(0, 200));
  }
  return (await r.json()).files || [];
}

/* Everything under the materials folder.
 *
 * A global `name contains` search would be one call instead of a dozen, and
 * it returns nothing: a service account's search corpus does not reliably
 * include files it can only reach through a folder shared with it. The Ch01
 * guide is readable by id and invisible to search, which looks exactly like
 * the file not existing. Walking down from the shared root uses only access
 * we know we have. Three levels covers
 * BJU TROVE AGENT / Study Guides / <class> / <file>.
 *
 * Exposed on its own so a dry run can report what the service account can
 * actually see — "not there" and "cannot see it" are otherwise identical
 * from the outside. */
export async function listChapterFiles(chapter) {
  if (!chapterKey(chapter)) return [];
  const token = await googleAccessToken(DRIVE_SCOPE);

  const files = [];
  let frontier = [MATERIALS_ROOT];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next = [];
    for (const id of frontier) {
      const children = await driveList("trashed = false and '" + id + "' in parents", token);
      for (const f of children) {
        if (f.mimeType === 'application/vnd.google-apps.folder') next.push(f.id);
        else files.push(f);
      }
    }
    frontier = next;
  }
  return files;
}

/* The exact file, or null. Deliberately exact: a near miss here means a
   student revises the wrong chapter, which is worse than being told the
   file is missing. */
export async function findMaterial({ chapter, kind, course }) {
  const want = materialKey(chapter, kind, course);
  if (!want) return null;
  const files = await listChapterFiles(chapter);
  return files.find((f) => slug(stripExtension(f.name)) === want) || null;
}

/* Google Docs have no bytes of their own, so they are exported as PDF;
   anything already a file is downloaded as it stands. */
export async function fetchMaterial(file) {
  const token = await googleAccessToken(DRIVE_SCOPE);
  const isNativeDoc = String(file.mimeType || '').startsWith('application/vnd.google-apps.');
  const url = isNativeDoc
    ? 'https://www.googleapis.com/drive/v3/files/' + file.id +
      '/export?mimeType=' + encodeURIComponent('application/pdf')
    : 'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media';

  const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) {
    throw new Error('drive fetch ' + r.status + ': ' + (await r.text()).slice(0, 200));
  }
  const content = Buffer.from(await r.arrayBuffer());
  const filename = isNativeDoc ? stripExtension(file.name) + '.pdf' : file.name;
  return { filename, content };
}
