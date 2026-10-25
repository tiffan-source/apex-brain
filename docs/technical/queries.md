## CONCEPTION EXPLANATION

In some domain lib, we could observe querie classes. This is because we want to seperate what is a usecase and what is a data fetching motivate by the client (web page, mobile, etc) need. It will consist of simple interface wich will be implement in the data storage infra.

### Anatomy of a query class

Since we are using a CQRS pattern, we will have a query class for each data fetching need. The query class will be an abstract class with a single method `execute` which will take an input and return an output. The input and output types will be defined as types in the same file.

### Error handling

There is no business error handling in a query class: a query never decides that something is
"forbidden" or "invalid", that is a use case's job.

An infrastructure failure (database unreachable, malformed response) is **not** swallowed into an
empty output: an empty list would make a client show "you have no objectives" when the truth is
"the objectives could not be loaded". The query lets the error propagate; the API turns it into a
`500 UNKNOWN_ERROR` and logs the cause. (Apex's original rule was "log and return an empty
output", but its Supabase queries already threw; Apex Brain keeps the behaviour and fixes the rule.)

"Not found" is not a failure: a query that looks up one element returns `null`, and the API
answers `404`.

### Ownership

Every query receives the `ownerId` of the person asking and only returns what belongs to them
(see `docs/adr/0002-acces-aux-donnees.md`).


### Distinction between query and usecase

If while implementing a query class, we find ourselves needing to implement some business logic, then we should create a usecase class instead. The query class should only be responsible for fetching data and returning it in the expected format.

Another things before creating an query class, we should ask ourselves if the client doesnt already have a way to get the data it needs. Maybe the data is already available in the client state.
