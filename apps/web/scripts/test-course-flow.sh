#!/bin/bash
# End-to-end smoke test for the teacher course + purchase flow (dev only).
set -e
BASE=http://localhost:3000

login() {
  curl -s -X POST $BASE/api/auth/otp/send -H "Content-Type: application/json" -d "{\"phone\":\"$1\"}" > /dev/null
  curl -s -X POST $BASE/api/auth/otp/verify -H "Content-Type: application/json" \
    -d "{\"phone\":\"$1\",\"code\":\"123456\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))"
}

echo "1. Login as teacher..."
TEACHER=$(login "+9647000000002")
echo "   token: ${TEACHER:0:16}..."

echo "2. Get teacher meta (subjects/stages)..."
META=$(curl -s $BASE/api/teacher/courses -H "Cookie: ulearn_session=$TEACHER")
SUBJECT=$(echo "$META" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['subjects'][0]['id'])")
STAGE=$(echo "$META" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['stages'][0]['id'])")
echo "   level: $(echo "$META" | python3 -c "import sys,json; print(json.load(sys.stdin)['level'])")"

echo "3. Teacher creates a course (25000 IQD)..."
COURSE=$(curl -s -X POST $BASE/api/teacher/courses -H "Content-Type: application/json" -H "Cookie: ulearn_session=$TEACHER" \
  -d "{\"titleEn\":\"Algebra Masterclass\",\"subjectId\":\"$SUBJECT\",\"stageId\":\"$STAGE\",\"price\":25000}")
CID=$(echo "$COURSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['course']['id'])")
echo "   course: $CID status=$(echo "$COURSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['course']['status'])")"

echo "4. Student tries to see it BEFORE approval..."
STUDENT=$(login "+9647100000001")
COUNT=$(curl -s "$BASE/api/store/courses" -H "Cookie: ulearn_session=$STUDENT" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['courses']))")
echo "   visible courses: $COUNT (course should NOT be included yet)"

echo "5. Admin approves the course..."
ADMIN=$(login "+9647000000001")
curl -s -X POST $BASE/api/admin/teacher-courses/$CID/review -H "Content-Type: application/json" \
  -H "Cookie: ulearn_session=$ADMIN" -d '{"decision":"APPROVED"}' | python3 -c "import sys,json; print('   status:', json.load(sys.stdin)['course']['status'])"

echo "6. Student sees it and requests purchase..."
curl -s -X POST $BASE/api/store/courses/$CID/purchase -H "Cookie: ulearn_session=$STUDENT" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('   purchase:', d['purchase']['id'], d['purchase']['status'])"
PID=$(curl -s "$BASE/api/admin/course-purchases?status=PENDING" -H "Cookie: ulearn_session=$ADMIN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['purchases'][0]['id'])")

echo "7. Admin confirms payment (revenue split by teacher level)..."
curl -s -X POST $BASE/api/admin/course-purchases -H "Content-Type: application/json" -H "Cookie: ulearn_session=$ADMIN" \
  -d "{\"purchaseId\":\"$PID\",\"action\":\"approve\"}" \
  | python3 -c "import sys,json; p=json.load(sys.stdin)['purchase']; print(f\"   level={p['teacherLevel']} deduction={p['deductionPct']}% platform={p['platformAmount']} teacher={p['teacherAmount']}\")"

echo "8. Teacher earnings..."
curl -s $BASE/api/teacher/courses -H "Cookie: ulearn_session=$TEACHER" \
  | python3 -c "import sys,json; e=json.load(sys.stdin)['earnings']; print(f\"   sales={e['sales']} gross={e['gross']} teacher={e['teacherRevenue']} platform={e['platformRevenue']}\")"

echo "9. Admin sets teacher level to NEEDS_IMPROVEMENT (courses must close)..."
TPID=$(echo "$META" | python3 -c "import sys,json; print(json.load(sys.stdin)['courses'][0]['teacherId'] if json.load(sys.stdin) else '')" 2>/dev/null || true)
TPID=$(curl -s $BASE/api/admin/teachers -H "Cookie: ulearn_session=$ADMIN" | python3 -c "import sys,json; ts=json.load(sys.stdin)['teachers']; print([t['teacherProfile']['id'] for t in ts if t['teacherProfile']][0])")
curl -s -X POST $BASE/api/admin/teachers/$TPID/level -H "Content-Type: application/json" -H "Cookie: ulearn_session=$ADMIN" \
  -d '{"level":"NEEDS_IMPROVEMENT"}' | python3 -c "import sys,json; print('   level:', json.load(sys.stdin)['level'])"
COUNT=$(curl -s "$BASE/api/store/courses" -H "Cookie: ulearn_session=$STUDENT" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['courses']))")
echo "   store now shows: $COUNT courses (should exclude the closed course)"

echo "10. Admin restores level to GOOD (course reopens)..."
curl -s -X POST $BASE/api/admin/teachers/$TPID/level -H "Content-Type: application/json" -H "Cookie: ulearn_session=$ADMIN" \
  -d '{"level":"GOOD"}' > /dev/null
COUNT=$(curl -s "$BASE/api/store/courses" -H "Cookie: ulearn_session=$STUDENT" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['courses']))")
echo "    store shows: $COUNT courses again"

echo "DONE"
