# U Learn – ER Diagram

```mermaid
erDiagram
  Country ||--o{ Province : has
  Country ||--o{ User : hosts
  Country ||--o{ EducationalStage : defines
  Country ||--o{ Subject : defines
  Country ||--o{ SubscriptionPackage : offers

  Province ||--o{ User : lives_in

  User ||--o| StudentProfile : has
  User ||--o| CertificateProfile : has
  User ||--o| TeacherProfile : has
  User ||--o{ Session : opens
  User ||--o{ Device : uses
  User ||--o{ Subscription : holds
  User ||--o{ ActivationRequest : submits
  User ||--o{ VideoProgress : tracks
  User ||--o{ QuizAttempt : takes
  User ||--o{ Certificate : earns
  User ||--o{ LessonQuestion : asks
  User ||--o{ AuditLog : performs

  EducationalStage ||--o{ Subject : contains
  Subject ||--o{ Chapter : contains
  Chapter ||--o{ Lesson : contains
  Lesson ||--o{ LessonContent : has
  Lesson ||--o{ VideoProgress : recorded_in
  Lesson ||--o{ LessonQuestion : receives
  LessonQuestion ||--o{ LessonAnswer : answered_by

  Subject ||--o{ SubscriptionPackage : packaged_as
  EducationalStage ||--o{ SubscriptionPackage : packaged_as
  SubscriptionPackage ||--o{ ActivationRequest : requested
  ActivationRequest ||--o{ ActivationCode : generates
  SubscriptionPackage ||--o{ Subscription : activates

  Quiz ||--o{ QuizQuestion : has
  Quiz ||--o{ QuizAttempt : records
  Lesson ||--o{ Quiz : lesson_quiz
  Chapter ||--o{ Quiz : chapter_quiz
  Subject ||--o{ Quiz : final_quiz

  TeacherProfile ||--o{ TeacherSubject : teaches
  Subject ||--o{ TeacherSubject : assigned
  Subject ||--o{ Certificate : awards

  Country ||--o{ IntroOutro : localizes
  Notification ||--o{ UserNotification : delivers
```

## Relationship Notes

| Parent | Child | Cardinality |
|--------|-------|-------------|
| Country | EducationalStage, Subject, Package | 1:N |
| Subject | Chapter | 1:N |
| Chapter | Lesson | 1:N |
| Lesson | LessonContent, Quiz, Questions | 1:N |
| User | Subscription, Progress, Attempts | 1:N |
| User ↔ Subject | Certificate | unique pair |
| User ↔ Lesson | VideoProgress | unique pair |
