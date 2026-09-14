-- CreateTable
CREATE TABLE "exercise_library" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "nameEn" VARCHAR(60),
    "primaryMuscleGroup" VARCHAR(30) NOT NULL,
    "secondaryMuscleGroups" VARCHAR(30)[] DEFAULT ARRAY[]::VARCHAR(30)[],
    "equipment" VARCHAR(30) NOT NULL,
    "movementType" VARCHAR(20) NOT NULL,
    "mechanics" VARCHAR(20) NOT NULL,
    "isUnilateral" BOOLEAN NOT NULL DEFAULT false,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "tags" VARCHAR(30)[] DEFAULT ARRAY[]::VARCHAR(30)[],
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "exercise_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" VARCHAR(50),
    "sessionDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "sessionType" VARCHAR(20) NOT NULL DEFAULT 'coach',
    "coachName" VARCHAR(30),
    "location" VARCHAR(50),
    "bodyweightKg" DECIMAL(5,2),
    "sessionRpe" DECIMAL(3,1),
    "feelingTag" VARCHAR(20),
    "totalSets" INTEGER NOT NULL DEFAULT 0,
    "totalVolumeKg" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "workMinutes" INTEGER,
    "prCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_exercises" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "nameSnapshot" VARCHAR(60) NOT NULL,
    "primaryMuscleGroupSnapshot" VARCHAR(30) NOT NULL,
    "equipmentSnapshot" VARCHAR(30) NOT NULL,
    "isUnilateralSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sets" (
    "id" TEXT NOT NULL,
    "workoutExerciseId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "weightKg" DECIMAL(6,2),
    "reps" INTEGER,
    "timeSec" INTEGER,
    "rpe" DECIMAL(3,1),
    "restSec" INTEGER,
    "isWarmup" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT true,
    "isPr" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exercise_library_slug_key" ON "exercise_library"("slug");

-- CreateIndex
CREATE INDEX "exercise_library_primaryMuscleGroup_isActive_deletedAt_idx" ON "exercise_library"("primaryMuscleGroup", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "exercise_library_equipment_idx" ON "exercise_library"("equipment");

-- CreateIndex
CREATE INDEX "exercise_library_ownerId_idx" ON "exercise_library"("ownerId");

-- CreateIndex
CREATE INDEX "exercise_library_creatorEmployeeId_idx" ON "exercise_library"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "exercise_library_updaterEmployeeId_idx" ON "exercise_library"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "workout_sessions_ownerId_sessionDate_deletedAt_idx" ON "workout_sessions"("ownerId", "sessionDate", "deletedAt");

-- CreateIndex
CREATE INDEX "workout_sessions_ownerId_sessionType_idx" ON "workout_sessions"("ownerId", "sessionType");

-- CreateIndex
CREATE INDEX "workout_sessions_creatorEmployeeId_idx" ON "workout_sessions"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "workout_sessions_updaterEmployeeId_idx" ON "workout_sessions"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "workout_exercises_sessionId_sortOrder_idx" ON "workout_exercises"("sessionId", "sortOrder");

-- CreateIndex
CREATE INDEX "workout_exercises_exerciseId_idx" ON "workout_exercises"("exerciseId");

-- CreateIndex
CREATE INDEX "workout_exercises_creatorEmployeeId_idx" ON "workout_exercises"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "workout_exercises_updaterEmployeeId_idx" ON "workout_exercises"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "workout_sets_workoutExerciseId_setNumber_idx" ON "workout_sets"("workoutExerciseId", "setNumber");

-- CreateIndex
CREATE INDEX "workout_sets_sessionId_idx" ON "workout_sets"("sessionId");

-- CreateIndex
CREATE INDEX "workout_sets_creatorEmployeeId_idx" ON "workout_sets"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "workout_sets_updaterEmployeeId_idx" ON "workout_sets"("updaterEmployeeId");

-- AddForeignKey
ALTER TABLE "exercise_library" ADD CONSTRAINT "exercise_library_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_library" ADD CONSTRAINT "exercise_library_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "workout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercise_library"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workoutExerciseId_fkey" FOREIGN KEY ("workoutExerciseId") REFERENCES "workout_exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
