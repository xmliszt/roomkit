import { Component, type ReactNode } from "react";

type AssetErrorBoundaryProps = {
  fallback: ReactNode;
  children: ReactNode;
  onError: () => void;
};

export class AssetErrorBoundary extends Component<
  AssetErrorBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn(`asset failed to load: ${error.message}`);
    this.props.onError();
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
