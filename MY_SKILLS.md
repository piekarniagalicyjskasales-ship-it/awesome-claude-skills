# Moje skille

Skille zainstalowane w tym repo w folderze [`.claude/skills/`](.claude/skills/). Claude Code wczytuje je automatycznie w każdej sesji, w której jest to repo.

Aby dodać nowy skill: skopiuj jego folder (z plikiem `SKILL.md`) do `.claude/skills/` i dopisz go poniżej.

## 21st.dev — UI i komponenty React/shadcn

Źródło: [21st-dev/skill](https://github.com/21st-dev/skill) · licencja Apache 2.0 ([LICENSE-21st-dev](.claude/skills/LICENSE-21st-dev)) · wymaga klucza API 21st.dev w zmiennej `TWENTYFIRST_TOKEN`.

| Skill | Opis |
|---|---|
| `21st-ai` | Generate and iterate on UI with 21st AI from the terminal via the `21st` CLI (`@21st-dev/cli`): sketch a UI from a prompt, preview the variants in the browser, edit any variant in … |
| `21st-cli-use` | Search, install and pull code from the 21st.dev catalog with the `21st` CLI (`@21st-dev/cli`): find React/shadcn components, themes and templates, print a component's code or a the… |
| `21st-design-sync` | Look at the current project's design (its shadcn / Tailwind CSS variables and color tokens) and publish it to the 21st.dev community as a shareable theme, using `21st publish-theme… |
| `21st-registry` | Publish your own work to 21st.dev and manage it from the terminal with the `21st` CLI (`@21st-dev/cli`): publish a React component to a team library, publish a CSS theme or a templ… |
| `21st-ui-build` | Build or substantially change production UI using the current project's design context, existing components, and grounded 21st inspiration. |
| `21st-ui-explore` | Explore and compare multiple meaningfully different UI directions grounded in the current project's design system and 21st inspiration. |
| `21st-ui-review` | Review existing UI against the project's design context, accessibility expectations, responsive behavior, interaction quality, and high-confidence production rules. |

## Fullstack Dev Skills (jeffallan)

Źródło: [jeffallan/claude-skills](https://github.com/jeffallan/claude-skills) · licencja MIT ([LICENSE-jeffallan](.claude/skills/LICENSE-jeffallan)) · 67 skilli eksperckich dla programistów.

| Skill | Opis |
|---|---|
| `angular-architect` | Generates Angular 17+ standalone components, configures advanced routing with lazy loading and guards, implements NgRx state management, applies RxJS patterns, and optimizes bundle… |
| `api-designer` | Use when designing REST or GraphQL APIs, creating OpenAPI specifications, or planning API architecture. |
| `architecture-designer` | Use when designing new high-level system architecture, reviewing existing designs, or making architectural decisions. |
| `atlassian-mcp` | Integrates with Atlassian products to manage project tracking and documentation via MCP protocol. |
| `chaos-engineer` | Designs chaos experiments, creates failure injection frameworks, and facilitates game day exercises for distributed systems — producing runbooks, experiment manifests, rollback pro… |
| `cli-developer` | Use when building CLI tools, implementing argument parsing, or adding interactive prompts. |
| `cloud-architect` | Designs cloud architectures, creates migration plans, generates cost optimization recommendations, and produces disaster recovery strategies across AWS, Azure, and GCP. |
| `code-documenter` | Generates, formats, and validates technical documentation — including docstrings, OpenAPI/Swagger specs, JSDoc annotations, doc portals, and user guides. |
| `code-reviewer` | Analyzes code diffs and files to identify bugs, security vulnerabilities (SQL injection, XSS, insecure deserialization), code smells, N+1 queries, naming issues, and architectural … |
| `cpp-pro` | Writes, optimizes, and debugs C++ applications using modern C++20/23 features, template metaprogramming, and high-performance systems techniques. |
| `csharp-developer` | Use when building C# applications with .NET 8+, ASP.NET Core APIs, or Blazor web apps. |
| `database-optimizer` | Optimizes database queries and improves performance across PostgreSQL and MySQL systems. |
| `debugging-wizard` | Parses error messages, traces execution flow through stack traces, correlates log entries to identify failure points, and applies systematic hypothesis-driven methodology to isolat… |
| `devops-engineer` | Creates Dockerfiles, configures CI/CD pipelines, writes Kubernetes manifests, and generates Terraform/Pulumi infrastructure templates. |
| `django-expert` | Use when building Django web applications or REST APIs with Django REST Framework. |
| `django-storages-s3` | Use when configuring Django to store static and media files on AWS S3 with django-storages. |
| `dotnet-core-expert` | Use when building .NET 8 applications with minimal APIs, clean architecture, or cloud-native microservices. |
| `embedded-systems` | Use when developing firmware for microcontrollers, implementing RTOS applications, or optimizing power consumption. |
| `fastapi-expert` | Use when building high-performance async Python APIs with FastAPI and Pydantic V2. |
| `feature-forge` | Conducts structured requirements workshops to produce feature specifications, user stories, EARS-format functional requirements, acceptance criteria, and implementation checklists. |
| `fine-tuning-expert` | Use when fine-tuning LLMs, training custom models, or adapting foundation models for specific tasks. |
| `flutter-expert` | Use when building cross-platform applications with Flutter 3+ and Dart. |
| `fullstack-guardian` | Builds security-focused full-stack web applications by implementing integrated frontend and backend components with layered security at every level. |
| `game-developer` | Use when building game systems, implementing Unity/Unreal Engine features, or optimizing game performance. |
| `golang-pro` | Implements concurrent Go patterns using goroutines and channels, designs and builds microservices with gRPC or REST, optimizes Go application performance with pprof, and enforces i… |
| `graphql-architect` | Use when designing GraphQL schemas, implementing Apollo Federation, or building real-time subscriptions. |
| `java-architect` | Use when building, configuring, or debugging enterprise Java applications with Spring Boot 3.x, microservices, or reactive programming. |
| `javascript-pro` | Writes, debugs, and refactors JavaScript code using modern ES2023+ features, async/await patterns, ESM module systems, and Node.js APIs. |
| `kotlin-specialist` | Provides idiomatic Kotlin implementation patterns including coroutine concurrency, Flow stream handling, multiplatform architecture, Compose UI construction, Ktor server setup, and… |
| `kubernetes-specialist` | Use when deploying or managing Kubernetes workloads. |
| `laravel-specialist` | Build and configure Laravel 10+ applications, including creating Eloquent models and relationships, implementing Sanctum authentication, configuring Horizon queues, designing RESTf… |
| `legacy-modernizer` | Designs incremental migration strategies, identifies service boundaries, produces dependency maps and migration roadmaps, and generates API facade designs for aging codebases. |
| `mcp-developer` | Use when building, debugging, or extending MCP servers or clients that connect AI systems with external tools and data sources. |
| `microservices-architect` | Designs distributed system architectures, decomposes monoliths into bounded-context services, recommends communication patterns, and produces service boundary diagrams and resilien… |
| `ml-pipeline` | Designs and implements production-grade ML pipeline infrastructure: configures experiment tracking with MLflow or Weights & Biases, creates Kubeflow or Airflow DAGs for training or… |
| `monitoring-expert` | Configures monitoring systems, implements structured logging pipelines, creates Prometheus/Grafana dashboards, defines alerting rules, and instruments distributed tracing. |
| `nestjs-expert` | Creates and configures NestJS modules, controllers, services, DTOs, guards, and interceptors for enterprise-grade TypeScript backend applications. |
| `nextjs-developer` | Use when building Next.js 14+ applications with App Router, server components, or server actions. |
| `pandas-pro` | Performs pandas DataFrame operations for data analysis, manipulation, and transformation. |
| `php-pro` | Use when building PHP applications with modern PHP 8.3+ features, Laravel, or Symfony frameworks. |
| `playwright-expert` | Use when writing E2E tests with Playwright, setting up test infrastructure, or debugging flaky browser tests. |
| `postgres-pro` | Use when optimizing PostgreSQL queries, configuring replication, or implementing advanced database features. |
| `prompt-engineer` | Writes, refactors, and evaluates prompts for LLMs — generating optimized prompt templates, structured output schemas, evaluation rubrics, and test suites. |
| `python-pro` | Use when building Python 3.11+ applications requiring type safety, async programming, or robust error handling. |
| `rag-architect` | Designs and implements production-grade RAG systems by chunking documents, generating embeddings, configuring vector stores, building hybrid search pipelines, applying reranking, a… |
| `rails-expert` | Rails 7+ specialist that optimizes Active Record queries with includes/eager_load, implements Turbo Frames and Turbo Streams for partial page updates, configures Action Cable for W… |
| `react-expert` | Use when building React 18+ applications in .jsx or .tsx files, Next.js App Router projects, or create-react-app setups. |
| `react-native-expert` | Builds, optimizes, and debugs cross-platform mobile applications with React Native and Expo. |
| `rust-engineer` | Writes, reviews, and debugs idiomatic Rust code with memory safety and zero-cost abstractions. |
| `salesforce-developer` | Writes and debugs Apex code, builds Lightning Web Components, optimizes SOQL queries, implements triggers, batch jobs, platform events, and integrations on the Salesforce platform. |
| `secure-code-guardian` | Use when implementing authentication/authorization, securing user input, or preventing OWASP Top 10 vulnerabilities — including custom security implementations such as hashing pass… |
| `security-reviewer` | Identifies security vulnerabilities, generates structured audit reports with severity ratings, and provides actionable remediation guidance. |
| `shopify-expert` | Builds and debugs Shopify themes (.liquid files, theme.json, sections), develops custom Shopify apps (shopify.app.toml, OAuth, webhooks), and implements Storefront API integrations… |
| `spark-engineer` | Use when writing Spark jobs, debugging performance issues, or configuring cluster settings for Apache Spark applications, distributed data processing pipelines, or big data workloa… |
| `spec-miner` | Reverse-engineering specialist that extracts specifications from existing codebases. |
| `spring-boot-engineer` | Generates Spring Boot 3.x configurations, creates REST controllers, implements Spring Security 6 authentication flows, sets up Spring Data JPA repositories, and configures reactive… |
| `sql-pro` | Optimizes SQL queries, designs database schemas, and troubleshoots performance issues. |
| `sre-engineer` | Defines service level objectives, creates error budget policies, designs incident response procedures, develops capacity models, and produces monitoring configurations and automati… |
| `swift-expert` | Builds iOS/macOS/watchOS/tvOS applications, implements SwiftUI views and state management, designs protocol-oriented architectures, handles async/await concurrency, implements acto… |
| `terraform-engineer` | Use when implementing infrastructure as code with Terraform across AWS, Azure, or GCP. |
| `test-master` | Generates test files, creates mocking strategies, analyzes code coverage, designs test architectures, and produces test plans and defect reports across functional, performance, and… |
| `the-fool` | Use when challenging ideas, plans, decisions, or proposals using structured critical reasoning. |
| `typescript-pro` | Implements advanced TypeScript type systems, creates custom type guards, utility types, and branded types, and configures tRPC for end-to-end type safety. |
| `vue-expert` | Builds Vue 3 components with Composition API patterns, configures Nuxt 3 SSR/SSG projects, sets up Pinia stores, scaffolds Quasar/Capacitor mobile apps, implements PWA features, an… |
| `vue-expert-js` | Creates Vue 3 components, builds vanilla JS composables, configures Vite projects, and sets up routing and state management using JavaScript only — no TypeScript. |
| `websocket-engineer` | Use when building real-time communication systems with WebSockets or Socket.IO. |
| `wordpress-pro` | Develops custom WordPress themes and plugins, creates and registers Gutenberg blocks and block patterns, configures WooCommerce stores, implements WordPress REST API endpoints, app… |
