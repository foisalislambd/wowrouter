import BoardPage from "@/pages/BoardPage";

export default function TeamsPage() {
  return (
    <div className="space-y-10">
      <BoardPage kind="orgs" title="Organizations" blurb="The top grouping for people and spend." placeholder='{"display_name":"Studio"}' />
      <BoardPage kind="teams" title="Teams" blurb="A team sits inside an organization and owns projects." placeholder='{"organization":"default"}' />
      <BoardPage kind="projects" title="Projects" blurb="Keys can name a project. The project names its team." placeholder='{"organization":"default","team":"default"}' />
    </div>
  );
}
