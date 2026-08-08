const React = window.React;

export class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[roam-map] a mounted map failed to render", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="rrm-shell" role="alert" aria-label="Roam Map error">
        <div className="rrm-error">
          This map could not render: {this.state.error?.message ?? String(this.state.error)}
        </div>
      </section>
    );
  }
}
