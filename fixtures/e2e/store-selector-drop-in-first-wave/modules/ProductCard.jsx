const memo = (component) => component;

const ProductCard = memo(({ product }) => (
	<article>
		<h2>{ product.name }</h2>
	</article>
));

export default ProductCard;
