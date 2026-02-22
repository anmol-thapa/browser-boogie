import TopNav from "./TopNav";
import "../pages/homepage.css";

type PlaceholderPageProps = {
  title: string;
};

export default function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="home">
      <TopNav />
      <main className="home-main">
        <h1 className="home-title">{title}</h1>
      </main>
    </div>
  );
}
