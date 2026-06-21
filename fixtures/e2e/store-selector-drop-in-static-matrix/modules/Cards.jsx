const React = { forwardRef: (component) => component };

export const ProductCard = React.forwardRef(({ product }, ref) => (
	<article ref={ ref }>
		<h3>{ product.name }</h3>
	</article>
));
