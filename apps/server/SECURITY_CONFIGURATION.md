# Security configuration

## Protected employee identity

Every deployed server environment (development, test, staging, and production) must inject `SUPER_ADMIN_EMPLOYEE_ID` as the protected employee's stable UUID. This identity no longer grants extra privileges; it only prevents the account from being deleted, disabled, renamed, or having its roles changed through generic admin APIs.

```dotenv
SUPER_ADMIN_EMPLOYEE_ID=<employee-uuid>
```

- Use the employee UUID only; never use a username, DingTalk ID, or PAT.
- The production value must be manually confirmed against the actual protected employee record before deployment.
- Production startup validates this variable and fails fast when it is missing, blank, or not a valid UUID. Protected-account guards also fail closed.
- Supply the value through the installer's own secret/configuration. Do not commit the real UUID.

## Role and permission changes

Creating, editing, or deleting roles requires the corresponding `system/user_role` RBAC permission plus a JWT authenticated within the last five minutes. PAT is rejected. An actor cannot grant permissions they do not already hold.
