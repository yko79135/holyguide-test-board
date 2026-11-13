/* What a signed-in person may see on the board.
 *
 * Mr. Ko (2026-11-13): "prevent students from seeing other students' test
 * dates." The server used to send every student every row and leave the
 * page to filter, so another student's dates were one browser tool away.
 * Now a student receives only his own rows and his own roster entry; Mr. Ko
 * (and Ezra's booking secret, which acts as the teacher) still get it all.
 * Anyone else — or a call that forgot to say who is looking — gets nothing.
 * Pure, so the rule is testable without a database. */
export function boardFor(board, viewer) {
  if (viewer && viewer.role === 'teacher') return board;
  const sid = viewer && viewer.role === 'student' ? viewer.studentId : null;
  return {
    ...board,
    students: sid ? board.students.filter((s) => s.id === sid) : [],
    proposals: sid ? board.proposals.filter((p) => p.student_id === sid) : [],
    lastRun: null,
  };
}
