# Tasks Implementation - Test Plan & Edge Cases

## Overview
This document outlines the test plan and edge cases for the Tasks feature implementation with provider fallback (Google Tasks, Microsoft To Do, and local DB storage).

## Implementation Summary

### Files Created/Modified

1. **Backend (Worker)**
   - `worker/src/index.ts`:
     - Domain Task Model types (`DomainTask`, `TaskStatus`, `TaskSource`)
     - Database schema extension (tasks table)
     - Provider connection check (`checkTasksProviderConnection`)
     - Google Tasks provider (`listGoogleTasks`, `createGoogleTask`, `completeGoogleTask`)
     - Microsoft To Do provider (`listMicrosoftTasks`, `createMicrosoftTask`, `completeMicrosoftTask`)
     - Local task storage (`listLocalTasks`, `createLocalTask`, `completeLocalTask`)
     - API Routes:
       - `GET /assistant/tasks` - List tasks (with provider/local fallback)
       - `POST /assistant/tasks` - Create task (with provider/local fallback)
       - `POST /assistant/tasks/:id/complete` - Complete task (with provider/local fallback)
     - Legacy routes maintained for backward compatibility

2. **Frontend (Fish Delish Site)**
   - `fish-delish-site/app/workspace/work/tasks/page.tsx` - Tasks screen UI
   - `fish-delish-site/components/merlin/dashboard/TasksWidget.tsx` - Dashboard widget

## Test Plan

### 1. Provider Connection Detection

#### Test Cases:
- ✅ **TC-001**: No provider connected - should use local storage
- ✅ **TC-002**: Google Tasks connected with valid tokens - should use Google Tasks API
- ✅ **TC-003**: Microsoft To Do connected with valid tokens - should use Microsoft To Do API
- ✅ **TC-004**: Both providers connected - should prefer first active connection (Google > Microsoft)
- ✅ **TC-005**: Provider connected but missing tasks scope - should fallback to local

**Test Steps:**
1. Check workspace connections for `domain='tasks'` and `status='active'`
2. Verify provider tokens exist and have required scopes
3. Confirm fallback logic when provider unavailable

### 2. List Tasks (GET /assistant/tasks)

#### Test Cases:
- ✅ **TC-101**: List tasks from Google Tasks provider
- ✅ **TC-102**: List tasks from Microsoft To Do provider
- ✅ **TC-103**: List tasks from local storage (no provider)
- ✅ **TC-104**: Provider API returns empty list
- ✅ **TC-105**: Provider API returns error (401, 403, 500) - should fallback to local
- ✅ **TC-106**: Mixed source tasks (should not occur, but handle gracefully)

**Test Steps:**
1. Connect provider and verify tasks are fetched from provider API
2. Disconnect provider and verify tasks are fetched from local DB
3. Simulate provider API errors and verify fallback to local
4. Verify response format matches `DomainTask[]`

### 3. Create Task (POST /assistant/tasks)

#### Test Cases:
- ✅ **TC-201**: Create task via Google Tasks provider
- ✅ **TC-202**: Create task via Microsoft To Do provider
- ✅ **TC-203**: Create task in local storage (no provider)
- ✅ **TC-204**: Provider API fails during create - should fallback to local
- ✅ **TC-205**: Missing required field (title) - should return 400
- ✅ **TC-206**: Task with due date
- ✅ **TC-207**: Task with description

**Test Steps:**
1. Create task with provider connected - verify it appears in provider
2. Create task without provider - verify it's stored locally
3. Simulate provider failure - verify fallback to local storage
4. Verify created task has correct `source` field (`provider` or `local`)

### 4. Complete Task (POST /assistant/tasks/:id/complete)

#### Test Cases:
- ✅ **TC-301**: Complete task via Google Tasks provider
- ✅ **TC-302**: Complete task via Microsoft To Do provider
- ✅ **TC-303**: Complete task in local storage
- ✅ **TC-304**: Complete non-existent task - should return 404
- ✅ **TC-305**: Provider API fails during complete - should fallback to local
- ✅ **TC-306**: Complete already completed task - should handle gracefully

**Test Steps:**
1. Complete task with provider connected - verify status updated in provider
2. Complete task without provider - verify status updated locally
3. Verify `completedAt` timestamp is set
4. Verify task status changes to `done`

### 5. UI Components

#### Test Cases:
- ✅ **TC-401**: Tasks page loads and displays tasks
- ✅ **TC-402**: Create task from UI
- ✅ **TC-403**: Complete task from UI (checkbox)
- ✅ **TC-404**: Filter tasks (all/open/done)
- ✅ **TC-405**: Display provider badge for provider tasks
- ✅ **TC-406**: Display "Local" badge for local tasks
- ✅ **TC-407**: Dashboard widget displays task count
- ✅ **TC-408**: Dashboard widget shows due today count
- ✅ **TC-409**: Dashboard widget links to tasks page

**Test Steps:**
1. Navigate to `/workspace/work/tasks`
2. Verify tasks list renders correctly
3. Create new task via form
4. Complete task via checkbox
5. Verify filters work correctly
6. Check dashboard widget displays correct counts

## Edge Cases & Error Handling

### 1. Token Expiration

**Scenario**: Provider token expires during API call

**Expected Behavior**:
- Google: `refreshGoogleAccessTokenIfNeeded` should refresh token automatically
- Microsoft: `refreshMicrosoftAccessTokenIfNeeded` should refresh token automatically
- If refresh fails: Fallback to local storage

**Implementation**:
- Token refresh is handled in provider functions
- If refresh fails, error is caught and fallback to local occurs

**Test**:
```bash
# Simulate expired token
# 1. Set token expires_at to past
# 2. Make API call
# 3. Verify refresh attempt
# 4. If refresh fails, verify fallback
```

### 2. Provider Offline/Network Error

**Scenario**: Provider API is unreachable (network error, timeout)

**Expected Behavior**:
- Catch network errors
- Fallback to local storage
- Log error for debugging

**Implementation**:
- Try-catch blocks in provider functions
- Error logging with `console.error`
- Fallback to local storage in catch blocks

**Test**:
```bash
# Simulate network failure
# 1. Block provider API domain
# 2. Make API call
# 3. Verify fallback to local
```

### 3. Invalid Provider Response

**Scenario**: Provider API returns unexpected format

**Expected Behavior**:
- Handle missing fields gracefully
- Use defaults for optional fields
- Don't crash on malformed responses

**Implementation**:
- Safe property access with `?.` and `||`
- Default values for optional fields
- Type checking where possible

**Test**:
```bash
# Mock provider API with invalid response
# 1. Return malformed JSON
# 2. Return missing fields
# 3. Verify graceful handling
```

### 4. Database Errors

**Scenario**: Local DB operations fail (D1 unavailable, schema issues)

**Expected Behavior**:
- Return appropriate error response
- Don't expose internal errors to client
- Log errors for debugging

**Implementation**:
- Try-catch in local storage functions
- Error messages sanitized
- HTTP 500 with generic error message

**Test**:
```bash
# Simulate DB failure
# 1. Disable ASSISTANT_DB binding
# 2. Make local storage call
# 3. Verify error handling
```

### 5. Concurrent Operations

**Scenario**: Multiple requests modify same task simultaneously

**Expected Behavior**:
- Last write wins (standard behavior)
- No data corruption
- Status updates are atomic

**Implementation**:
- Database transactions where possible
- Provider APIs handle concurrency
- No explicit locking (rely on DB/API)

**Test**:
```bash
# Concurrent requests
# 1. Complete same task from multiple clients
# 2. Verify no corruption
# 3. Verify final state is consistent
```

### 6. Provider Task ID Mismatch

**Scenario**: Task ID from provider doesn't match local ID

**Expected Behavior**:
- Provider tasks use provider ID
- Local tasks use local ID
- No ID conflicts

**Implementation**:
- Provider tasks: `id = providerId`
- Local tasks: `id = local-task-{timestamp}-{random}`
- `providerId` field stores original provider ID for provider tasks

**Test**:
```bash
# Verify ID handling
# 1. Create task in provider
# 2. Verify id matches providerId
# 3. Create task locally
# 4. Verify id is local format
```

### 7. Missing Workspace/User Context

**Scenario**: Request missing workspace or user ID

**Expected Behavior**:
- Return 400 Bad Request
- Clear error message
- Don't proceed with operation

**Implementation**:
- Validation in API routes
- `resolveSessionActiveWorkspaceId` checks
- Early returns with error responses

**Test**:
```bash
# Missing context
# 1. Request without session
# 2. Request without workspace
# 3. Verify 400/401 responses
```

### 8. Large Task Lists

**Scenario**: User has hundreds/thousands of tasks

**Expected Behavior**:
- API should handle pagination (future enhancement)
- UI should handle large lists (virtualization)
- Performance should remain acceptable

**Current Implementation**:
- No pagination (returns all tasks)
- UI renders all tasks (may need optimization)

**Future Enhancement**:
- Add pagination to API
- Add virtual scrolling to UI

### 9. Provider Scope Changes

**Scenario**: User revokes tasks scope after connection

**Expected Behavior**:
- Detect missing scope
- Fallback to local storage
- Clear error message

**Implementation**:
- `checkTasksProviderConnection` verifies scopes
- Returns `null` provider if scope missing
- Falls back to local

**Test**:
```bash
# Revoke scope
# 1. Connect provider with tasks scope
# 2. Revoke scope in provider settings
# 3. Make API call
# 4. Verify fallback to local
```

### 10. Task Migration

**Scenario**: User connects provider after having local tasks

**Expected Behavior**:
- Local tasks remain in local storage
- New tasks go to provider
- No automatic migration (by design)

**Implementation**:
- Source field distinguishes provider vs local
- No migration logic (explicit user action required)

**Future Enhancement**:
- Add migration endpoint/UI
- Allow user to move local tasks to provider

## API Response Formats

### GET /assistant/tasks
```json
[
  {
    "id": "task-id",
    "title": "Task title",
    "status": "open",
    "due": "2024-01-15T00:00:00Z",
    "source": "provider",
    "providerId": "provider-task-id",
    "providerName": "google",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-02T00:00:00Z",
    "description": "Task description",
    "completedAt": null
  }
]
```

### POST /assistant/tasks
**Request:**
```json
{
  "title": "New task",
  "due": "2024-01-15T00:00:00Z",
  "description": "Optional description"
}
```

**Response:**
```json
{
  "id": "task-id",
  "title": "New task",
  "status": "open",
  "due": "2024-01-15T00:00:00Z",
  "source": "provider",
  "providerId": "provider-task-id",
  "providerName": "google",
  "createdAt": "2024-01-01T00:00:00Z",
  "description": "Optional description"
}
```

### POST /assistant/tasks/:id/complete
**Response:**
```json
{
  "id": "task-id",
  "title": "Task title",
  "status": "done",
  "source": "provider",
  "providerId": "provider-task-id",
  "providerName": "google",
  "createdAt": "2024-01-01T00:00:00Z",
  "completedAt": "2024-01-15T12:00:00Z"
}
```

## Error Responses

### 400 Bad Request
```json
{
  "ok": false,
  "error": "title is required"
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication required"
}
```

### 404 Not Found
```json
{
  "ok": false,
  "error": "Task not found"
}
```

### 500 Internal Server Error
```json
{
  "ok": false,
  "error": "failed to create task"
}
```

## Performance Considerations

1. **Provider API Rate Limits**
   - Google Tasks: 1,000 requests/day per user
   - Microsoft To Do: 10,000 requests/10 minutes
   - Implement caching for list operations (future)

2. **Database Queries**
   - Index on `workspace_id`, `user_id`, `status`
   - Limit results (future pagination)

3. **UI Rendering**
   - Virtual scrolling for large lists (future)
   - Debounce search/filter inputs

## Security Considerations

1. **Token Storage**
   - Tokens stored in ASSISTANT_KV (encrypted)
   - Never exposed to client

2. **Authorization**
   - All routes require session
   - Workspace membership verified
   - Capability checks (`work.tasks.view`, `work.tasks.write`)

3. **Input Validation**
   - Title required and trimmed
   - Dates validated
   - SQL injection prevention (parameterized queries)

## Migration Notes

1. **Existing `seedTasksForKey` function**
   - Still exists for backward compatibility
   - New implementation uses DB/local storage
   - Legacy routes maintained

2. **Database Migration**
   - New `tasks` table added to schema
   - Run `wrangler d1 migrations apply` to create table

3. **Breaking Changes**
   - None - legacy routes maintained
   - New routes are additive

## Future Enhancements

1. **Pagination**
   - Add `limit` and `offset` to list endpoint
   - Implement cursor-based pagination

2. **Task Updates**
   - Full update endpoint (currently only complete)
   - Update title, due date, description

3. **Task Deletion**
   - Soft delete (status = 'cancelled')
   - Hard delete endpoint

4. **Task Migration**
   - Move local tasks to provider
   - Sync provider tasks to local

5. **Task Lists**
   - Support multiple task lists (Google/Microsoft)
   - Allow user to select default list

6. **Notifications**
   - Due date reminders
   - Task completion notifications

7. **Search & Filtering**
   - Full-text search
   - Advanced filters (status, due date, source)

8. **Bulk Operations**
   - Complete multiple tasks
   - Delete multiple tasks
   - Move multiple tasks

## Testing Checklist

- [ ] Unit tests for provider functions
- [ ] Unit tests for local storage functions
- [ ] Integration tests for API routes
- [ ] E2E tests for UI components
- [ ] Load testing for large task lists
- [ ] Security testing for authorization
- [ ] Error scenario testing
- [ ] Cross-browser testing
- [ ] Mobile responsiveness testing

## Deployment Checklist

- [ ] Database migration applied
- [ ] Environment variables configured
- [ ] OAuth scopes verified
- [ ] API routes tested
- [ ] UI components tested
- [ ] Error handling verified
- [ ] Performance acceptable
- [ ] Security review completed
- [ ] Documentation updated


