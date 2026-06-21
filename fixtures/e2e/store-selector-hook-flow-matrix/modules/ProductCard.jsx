import { BadgeList } from './BadgeList.jsx';
import { useProductView } from './hooks.jsx';

export const ProductCard = ({ product }) => {
	const { name, badges } = useProductView(product);
	return (
		<article>
			<h2>{ name }</h2>
			<BadgeList badges={ badges } />
		</article>
	);
};
