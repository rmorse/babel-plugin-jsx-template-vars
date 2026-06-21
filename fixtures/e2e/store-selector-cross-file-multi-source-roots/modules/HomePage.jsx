import { Header } from './Header.jsx';
import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const HomePage = () => {
	const hero = useStoreSelector((state) => state.home.hero);
	return (
		<main>
			<Header hero={ hero } />
		</main>
	);
};

module.exports = { HomePage };
